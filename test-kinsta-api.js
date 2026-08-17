require('dotenv').config();

const {
  getLiveEnvironments,
  clearSiteCache,
  pollOperation
} = require('./lib/kinsta');

async function testCacheClear() {
  try {
    console.log('Fetching live environments...');
    const environments = await getLiveEnvironments();

    if (environments.length === 0) {
      console.log('No live environments found on this Kinsta account.');
      return;
    }

    const target = environments[0];
    console.log(`\nTesting cache clear for: ${target.siteName} (${target.primaryDomain || 'no domain'})`);
    console.log(`Environment ID: ${target.environmentId}`);

    const { operation_id: operationId } = await clearSiteCache(target.environmentId);
    console.log(`Operation started: ${operationId}`);

    console.log('Polling for completion...');
    const result = await pollOperation(operationId);
    console.log(result.success
      ? `✅ Confirmed cleared: ${result.message}`
      : `⚠️ Did not confirm: ${result.message}`);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testCacheClear();
