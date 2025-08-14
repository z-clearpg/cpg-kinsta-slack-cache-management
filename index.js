const { App } = require('@slack/bolt');
const axios = require('axios');
require('dotenv').config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000
});

const kinstaApiClient = axios.create({
  baseURL: 'https://api.kinsta.com/v2',
  headers: {
    'Authorization': `Bearer ${process.env.KINSTA_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function getCompanyId() {
  try {
    const response = await kinstaApiClient.get('/validate');
    return response.data.company;
  } catch (error) {
    console.error('Error validating API key:', error.response?.data || error.message);
    throw error;
  }
}

async function getSites() {
  try {
    const companyId = await getCompanyId();
    const response = await kinstaApiClient.get(`/sites?company=${companyId}&include_environments=true`);
    return response.data.company.sites || [];
  } catch (error) {
    console.error('Error fetching sites:', error.response?.data || error.message);
    throw error;
  }
}

async function clearSiteCache(environmentId) {
  try {
    const response = await kinstaApiClient.post(`/sites/tools/clear-cache`, {
      environment_id: environmentId
    });
    return response.data;
  } catch (error) {
    console.error('Error clearing cache:', error.response?.data || error.message);
    throw error;
  }
}

app.command('/clear-cache', async ({ command, ack, respond }) => {
  await ack();

  try {
    const sites = await getSites();
    
    if (sites.length === 0) {
      await respond({
        text: 'No sites found in your Kinsta account.',
        response_type: 'ephemeral'
      });
      return;
    }

    const siteOptions = [];
    sites.forEach(site => {
      site.environments.forEach(env => {
        siteOptions.push({
          text: {
            type: 'plain_text',
            text: `${site.display_name} - ${env.display_name} (${env.name})`
          },
          value: env.id
        });
      });
    });

    await respond({
      text: 'Select a site to clear cache:',
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Select a site to clear its cache:'
          },
          accessory: {
            type: 'static_select',
            placeholder: {
              type: 'plain_text',
              text: 'Choose a site'
            },
            options: siteOptions,
            action_id: 'site_select'
          }
        }
      ]
    });
  } catch (error) {
    await respond({
      text: 'Error fetching sites. Please check your Kinsta API configuration.',
      response_type: 'ephemeral'
    });
  }
});

app.action('site_select', async ({ body, ack, respond }) => {
  await ack();

  const selectedEnvironmentId = body.actions[0].selected_option.value;
  const environmentName = body.actions[0].selected_option.text.text;

  await respond({
    text: `Confirm cache clearing for ${environmentName}?`,
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Are you sure you want to clear the cache for *${environmentName}*?`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Yes, Clear Cache'
            },
            style: 'primary',
            action_id: 'confirm_clear',
            value: selectedEnvironmentId
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Cancel'
            },
            action_id: 'cancel_clear'
          }
        ]
      }
    ]
  });
});

app.action('confirm_clear', async ({ body, ack, respond }) => {
  await ack();

  const environmentId = body.actions[0].value;

  try {
    await respond({
      text: 'Clearing cache... Please wait.',
      response_type: 'ephemeral'
    });

    await clearSiteCache(environmentId);

    await respond({
      text: '✅ Cache cleared successfully!',
      response_type: 'ephemeral'
    });
  } catch (error) {
    await respond({
      text: '❌ Failed to clear cache. Please try again or check your permissions.',
      response_type: 'ephemeral'
    });
  }
});

app.action('cancel_clear', async ({ ack, respond }) => {
  await ack();
  
  await respond({
    text: 'Cache clearing cancelled.',
    response_type: 'ephemeral'
  });
});

(async () => {
  try {
    await app.start();
    console.log('⚡️ Kinsta Cache Manager bot is running!');
  } catch (error) {
    console.error('Error starting app:', error);
  }
})();