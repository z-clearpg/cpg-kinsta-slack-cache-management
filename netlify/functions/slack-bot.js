const { App, AwsLambdaReceiver } = require('@slack/bolt');

const { registerHandlers } = require('../../lib/slack-handlers');

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
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
