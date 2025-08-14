const axios = require('axios');
require('dotenv').config();

const kinstaApiClient = axios.create({
  baseURL: 'https://api.kinsta.com/v2',
  headers: {
    'Authorization': `Bearer ${process.env.KINSTA_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function testCacheClear() {
  try {
    console.log('Getting sites...');
    const validateResponse = await kinstaApiClient.get('/validate');
    const companyId = validateResponse.data.company;
    const sitesResponse = await kinstaApiClient.get(`/sites?company=${companyId}&include_environments=true`);
    
    // Get first environment ID for testing
    const firstSite = sitesResponse.data.company.sites[0];
    const firstEnv = firstSite.environments[0];
    
    console.log(`\nTesting cache clear for: ${firstSite.display_name} - ${firstEnv.display_name}`);
    console.log(`Environment ID: ${firstEnv.id}`);
    
    const clearResponse = await kinstaApiClient.post(`/sites/tools/clear-cache`, {
      environment_id: firstEnv.id
    });
    console.log('Cache clear response:', JSON.stringify(clearResponse.data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testCacheClear();