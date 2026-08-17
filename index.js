const { App } = require('@slack/bolt');
require('dotenv').config();

const { registerHandlers } = require('./lib/slack-handlers');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000
});

registerHandlers(app);

(async () => {
  try {
    await app.start();
    console.log('⚡️ Kinsta Cache Manager bot is running!');
  } catch (error) {
    console.error('Error starting app:', error);
  }
})();
