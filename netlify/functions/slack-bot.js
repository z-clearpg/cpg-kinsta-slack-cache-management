const { App, AwsLambdaReceiver } = require('@slack/bolt');

const { registerHandlers } = require('../../lib/slack-handlers');

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
  // Skip the auth.test round-trip Bolt otherwise makes during initialization.
  // On a cold Lambda that call (plus init time) pushed the slash-command ack
  // past Slack's 3s limit -> operation_timeout. We don't need the auth data.
  deferInitialization: true,
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
