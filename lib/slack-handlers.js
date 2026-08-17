const {
  clearSiteCache,
  pollOperation
} = require('./kinsta');
const { getLiveEnvironmentsFast } = require('./site-cache');

// Slack caps a single external_select option list at 100 entries.
const MAX_OPTIONS = 100;

/**
 * Build a Slack option object for a live environment. The label shows the site
 * title and its primary domain so the two are distinguishable even when they
 * differ; the value carries the environment id plus a human label so downstream
 * handlers can name what was cleared without another API lookup.
 */
function toOption(env) {
  const label = env.primaryDomain
    ? `${env.siteName} — ${env.primaryDomain}`
    : env.siteName;

  return {
    text: {
      type: 'plain_text',
      // Slack truncates option text at 75 chars.
      text: label.length > 75 ? `${label.slice(0, 72)}...` : label
    },
    value: JSON.stringify({ id: env.environmentId, label })
  };
}

/**
 * Trigger a cache clear and report the outcome via `respond`.
 *
 * Timing constraint: the AwsLambdaReceiver only returns Slack's HTTP response
 * when the handler resolves — ack() does NOT flush early. So a slash command
 * that polls (seconds) blows past Slack's ~3s limit → "operation_timeout" and
 * the typed command is restored to the composer. Two modes handle this:
 *
 * @param {Function} respond  Bolt respond() for this interaction
 * @param {{id: string, label: string}} target  environment id + display label
 * @param {object} [opts]
 * @param {boolean} [opts.poll=false]
 *   false (slash command): fire the clear and reply "started", then return
 *     immediately — stays within the 3s window, composer clears and stays clear.
 *   true (confirm button): poll to a confirmed ✅ result. Interactive actions
 *     tolerate the longer response.
 * @param {boolean} [opts.replaceOriginal=false]
 *   true updates the message in place (correct for the confirm button). MUST be
 *   false for slash commands — Slack disallows replace_original there and it
 *   causes the typed command to be re-inserted into the composer.
 */
async function runCacheClear(respond, target, { poll = false, replaceOriginal = false } = {}) {
  const reply = (text) =>
    respond({ response_type: 'ephemeral', replace_original: replaceOriginal, text });

  try {
    const { operation_id: operationId } = await clearSiteCache(target.id);

    if (!operationId) {
      // Shouldn't happen per the API contract, but don't claim success blindly.
      throw new Error('Kinsta did not return an operation id.');
    }

    if (!poll) {
      // Kinsta accepted the clear (202); it finishes on its own. Reply now and
      // return so the slash command never times out.
      await reply(`✅ Cache clear started for *${target.label}* — it'll finish in a few seconds.`);
      return;
    }

    // Interactive path: show progress, then confirm the real outcome.
    await reply(`⌛ Clearing cache for *${target.label}*…`);
    const result = await pollOperation(operationId, { intervalMs: 1500, timeoutMs: 15000 });

    if (result.success) {
      await reply(`✅ Cache cleared for *${target.label}*`);
    } else if (result.timedOut) {
      await reply(`✅ Cache clear submitted for *${target.label}* — finishing up now.`);
    } else {
      console.error(`Cache clear failed for ${target.id} (${operationId}): ${result.message}`);
      await reply(`⚠️ Cache clear for *${target.label}* didn't confirm: ${result.message}`);
    }
  } catch (error) {
    console.error('Error clearing cache:', error.response?.data || error.message);
    await reply(`❌ Failed to clear cache for *${target.label}*. Please try again or check permissions.`);
  }
}

/**
 * Registers all cache-manager handlers on a Bolt `app`. Both the standalone
 * (index.js) and the Netlify serverless entry point share this single source
 * of truth so behavior can never drift between deployments.
 */
function registerHandlers(app) {
  // Slash command: always open the type-ahead picker. Any text after the
  // command is ignored — users search by name or domain inside the dropdown.
  // (A direct "/clear-cache <domain>" clear was removed: on AwsLambdaReceiver
  // the ack isn't sent until the handler finishes, so doing the clear inline
  // tripped Slack's 3s "operation_timeout" and restored the typed command.)
  app.command('/clear-cache', async ({ ack, respond }) => {
    await ack();

    await respond({
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Search for a site by *name* or *domain* to clear its live cache:'
          },
          accessory: {
            type: 'external_select',
            placeholder: {
              type: 'plain_text',
              text: 'Type a site name or domain'
            },
            min_query_length: 0,
            action_id: 'site_select'
          }
        }
      ]
    });
  });

  // Options load for the external_select: filter live envs by typed text
  // against the site title AND all associated domains.
  app.options('site_select', async ({ options, ack }) => {
    try {
      const query = (options.value || '').trim().toLowerCase();
      const environments = await getLiveEnvironmentsFast();
      console.log(`site_select options: query="${query}" total=${environments.length}`);

      const matches = query
        ? environments.filter(env => env.searchText.includes(query))
        : environments;

      // Stable, predictable ordering by site name.
      matches.sort((a, b) => a.siteName.localeCompare(b.siteName));

      console.log(`site_select options: returning ${Math.min(matches.length, MAX_OPTIONS)} of ${matches.length} matches`);
      await ack({
        options: matches.slice(0, MAX_OPTIONS).map(toOption)
      });
    } catch (error) {
      console.error('Error loading site options:', error.response?.status, error.response?.data || error.message, error.stack);
      await ack({ options: [] });
    }
  });

  // A selection was made: show a confirmation prompt.
  app.action('site_select', async ({ body, ack, respond }) => {
    await ack();

    const selected = JSON.parse(body.actions[0].selected_option.value);

    await respond({
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Clear the *live* cache for *${selected.label}*?`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Yes, clear cache' },
              style: 'primary',
              action_id: 'confirm_clear',
              value: body.actions[0].selected_option.value
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Cancel' },
              action_id: 'cancel_clear'
            }
          ]
        }
      ]
    });
  });

  // Confirmed via the picker: clear and report the confirmed result. This is an
  // interactive action, so replace_original updates the message with the buttons
  // in place (and can't confuse a slash-command composer).
  app.action('confirm_clear', async ({ body, ack, respond }) => {
    await ack();
    const selected = JSON.parse(body.actions[0].value);
    await runCacheClear(respond, selected, { poll: true, replaceOriginal: true });
  });

  // Cancelled: clean up the prompt.
  app.action('cancel_clear', async ({ ack, respond }) => {
    await ack();
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: 'Cache clearing cancelled.'
    });
  });
}

module.exports = { registerHandlers };
