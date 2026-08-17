const {
  getLiveEnvironments,
  findLiveEnvironmentByExactMatch,
  clearSiteCache,
  pollOperation
} = require('./kinsta');

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
 * Clear a live environment's cache, poll Kinsta to completion, and report the
 * real outcome via `respond`. Shared by the confirm-button flow and the direct
 * `/clear-cache <domain>` flow so both behave identically.
 *
 * @param {Function} respond  Bolt respond() for this interaction
 * @param {{id: string, label: string}} target  environment id + display label
 */
async function runCacheClear(respond, target) {
  // Replace whatever prompted this with an in-progress notice.
  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:hourglass_flowing_sand: Clearing cache for *${target.label}*…`
        }
      }
    ]
  });

  try {
    const { operation_id: operationId } = await clearSiteCache(target.id);

    if (!operationId) {
      // Shouldn't happen per the API contract, but don't claim success blindly.
      throw new Error('Kinsta did not return an operation id.');
    }

    const result = await pollOperation(operationId);

    if (result.success) {
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `✅ Cache cleared for *${target.label}*`
      });
    } else {
      console.error(`Cache clear failed for ${target.id} (${operationId}): ${result.message}`);
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `⚠️ Cache clear for *${target.label}* didn't confirm: ${result.message}`
      });
    }
  } catch (error) {
    console.error('Error clearing cache:', error.response?.data || error.message);
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: `❌ Failed to clear cache for *${target.label}*. Please try again or check permissions.`
    });
  }
}

/**
 * Registers all cache-manager handlers on a Bolt `app`. Both the standalone
 * (index.js) and the Netlify serverless entry point share this single source
 * of truth so behavior can never drift between deployments.
 */
function registerHandlers(app) {
  // Slash command. With an argument (e.g. `/clear-cache clear-pg.com`) that
  // exactly matches one live site's domain or title, clear it directly. With no
  // argument, or an ambiguous/unknown one, fall back to the type-ahead picker.
  app.command('/clear-cache', async ({ command, ack, respond }) => {
    await ack();

    const query = (command.text || '').trim();

    if (query) {
      let match = null;
      try {
        match = await findLiveEnvironmentByExactMatch(query);
      } catch (error) {
        console.error('Error matching site argument:', error.response?.data || error.message);
        await respond({
          response_type: 'ephemeral',
          text: '❌ Error looking up sites. Please check the Kinsta API configuration.'
        });
        return;
      }

      if (match) {
        // Exact match -> clear immediately, no confirmation step.
        const label = match.primaryDomain
          ? `${match.siteName} — ${match.primaryDomain}`
          : match.siteName;
        await runCacheClear(respond, { id: match.environmentId, label });
        return;
      }

      // No exact match: tell the user, then drop into the picker below.
      await respond({
        response_type: 'ephemeral',
        text: `No live site exactly matches *${query}*. Search for one instead:`
      });
    }

    await respond({
      response_type: 'ephemeral',
      // When we already sent the "no match" note above, add the picker as a new
      // message rather than replacing it.
      replace_original: query ? false : undefined,
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
      const environments = await getLiveEnvironments();

      const matches = query
        ? environments.filter(env => env.searchText.includes(query))
        : environments;

      // Stable, predictable ordering by site name.
      matches.sort((a, b) => a.siteName.localeCompare(b.siteName));

      await ack({
        options: matches.slice(0, MAX_OPTIONS).map(toOption)
      });
    } catch (error) {
      console.error('Error loading site options:', error.response?.data || error.message);
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

  // Confirmed via the picker: run the shared clear + poll + report routine.
  app.action('confirm_clear', async ({ body, ack, respond }) => {
    await ack();
    const selected = JSON.parse(body.actions[0].value);
    await runCacheClear(respond, selected);
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
