const { App, AwsLambdaReceiver } = require('@slack/bolt');

const { registerHandlers } = require('../../lib/slack-handlers');

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  receiver: awsLambdaReceiver,
  // Supplying a static authorize function makes Bolt skip the auth.test network
  // call it otherwise runs at startup. On a cold Lambda that call added seconds
  // to init (measured ~6.8s cold), blowing Slack's 3s limit. Single-workspace
  // bot: just return the bot token. (Unlike deferInitialization, this keeps the
  // authorize function defined, so event handling still works.)
  authorize: async () => ({ botToken: process.env.SLACK_BOT_TOKEN }),
});

registerHandlers(app);

// Node 24 Lambda runtimes dropped support for the callback-style handler, so we
// use the promise-returning signature: await the receiver's handler and return
// its { statusCode, body } result directly instead of passing a callback.
const receiverHandler = awsLambdaReceiver.start();

module.exports.handler = async (event, context) => {
  const handler = await receiverHandler;
  return handler(event, context);
};
