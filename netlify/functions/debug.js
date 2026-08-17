// Temporary diagnostic endpoint. Hit it directly (no Slack signature needed) to
// see what the Kinsta API actually returns in the deployed environment:
//
//   GET /.netlify/functions/debug
//
// It never prints the API key. REMOVE this file once debugging is done.
const {
  getCompanyId,
  getSites,
  getLiveEnvironments,
  kinstaApiClient
} = require('../../lib/kinsta');

function ok(obj) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) };
}

module.exports.handler = async () => {
  const report = {
    env: {
      hasKinstaKey: Boolean(process.env.KINSTA_API_KEY),
      kinstaKeyLength: (process.env.KINSTA_API_KEY || '').length,
      hasSlackToken: Boolean(process.env.SLACK_BOT_TOKEN),
      hasSigningSecret: Boolean(process.env.SLACK_SIGNING_SECRET)
    },
    steps: {}
  };

  // Step 1: validate / company id
  try {
    const companyId = await getCompanyId();
    report.steps.validate = { ok: true, companyId };
  } catch (error) {
    report.steps.validate = {
      ok: false,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    };
    return ok(report); // can't proceed without a company id
  }

  // Step 2: raw sites response (top-level keys + shape), so we can see the
  // actual JSON structure without dumping everything.
  try {
    const companyId = report.steps.validate.companyId;
    const raw = await kinstaApiClient.get(
      `/sites?company=${companyId}&include_environments=true`
    );
    const data = raw.data || {};
    report.steps.rawSites = {
      ok: true,
      topLevelKeys: Object.keys(data),
      hasCompany: Boolean(data.company),
      companyKeys: data.company ? Object.keys(data.company) : null,
      sitesLocation: Array.isArray(data.sites)
        ? 'data.sites'
        : Array.isArray(data.company?.sites)
        ? 'data.company.sites'
        : 'UNKNOWN',
      sampleSite: (data.company?.sites || data.sites || [])[0]
        ? {
            keys: Object.keys((data.company?.sites || data.sites)[0]),
            envKeys: ((data.company?.sites || data.sites)[0].environments || [])[0]
              ? Object.keys((data.company?.sites || data.sites)[0].environments[0])
              : null
          }
        : null
    };
  } catch (error) {
    report.steps.rawSites = {
      ok: false,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    };
  }

  // Step 3: what getSites() returns through our current parsing
  try {
    const sites = await getSites();
    report.steps.getSites = { ok: true, count: sites.length };
  } catch (error) {
    report.steps.getSites = { ok: false, message: error.message };
  }

  // Step 4: what getLiveEnvironments() produces (the picker's source)
  try {
    const envs = await getLiveEnvironments();
    report.steps.getLiveEnvironments = {
      ok: true,
      count: envs.length,
      sample: envs.slice(0, 5).map(e => ({
        siteName: e.siteName,
        primaryDomain: e.primaryDomain,
        domains: e.domains
      }))
    };
  } catch (error) {
    report.steps.getLiveEnvironments = { ok: false, message: error.message };
  }

  return ok(report);
};
