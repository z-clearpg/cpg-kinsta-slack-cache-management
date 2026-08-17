const axios = require('axios');

const kinstaApiClient = axios.create({
  baseURL: 'https://api.kinsta.com/v2',
  headers: {
    'Authorization': `Bearer ${process.env.KINSTA_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// The company ID never changes for a given API key, so we validate once and
// cache it for the lifetime of the process instead of re-fetching per command.
let cachedCompanyId = null;

async function getCompanyId() {
  if (cachedCompanyId) return cachedCompanyId;
  try {
    const response = await kinstaApiClient.get('/validate');
    cachedCompanyId = response.data?.company;
    if (!cachedCompanyId) {
      // Log the shape (not secrets) so we can see what /validate actually returned.
      console.error('getCompanyId: no company id in /validate response. keys=',
        Object.keys(response.data || {}));
    }
    return cachedCompanyId;
  } catch (error) {
    console.error('getCompanyId: /validate failed. status=', error.response?.status,
      'body=', JSON.stringify(error.response?.data || error.message));
    throw error;
  }
}

async function getSites() {
  const companyId = await getCompanyId();
  try {
    const response = await kinstaApiClient.get(
      `/sites?company=${companyId}&include_environments=true`
    );
    const data = response.data || {};

    // Be tolerant of shape: the sites array may be at data.company.sites or
    // data.sites depending on the endpoint/version.
    const sites = data.company?.sites || data.sites || [];

    if (!Array.isArray(sites) || sites.length === 0) {
      console.error('getSites: no sites parsed. topLevelKeys=', Object.keys(data),
        'companyKeys=', data.company ? Object.keys(data.company) : null,
        'companyIdUsed=', companyId);
    }
    return Array.isArray(sites) ? sites : [];
  } catch (error) {
    console.error('getSites: /sites failed. status=', error.response?.status,
      'body=', JSON.stringify(error.response?.data || error.message));
    throw error;
  }
}

/**
 * Flatten sites into a list of *live* environments only, each carrying a
 * pre-built lowercase search string that includes the site title, site slug,
 * and every domain name so users can find a site by domain even when the
 * display name doesn't match the domain.
 */
async function getLiveEnvironments() {
  const sites = await getSites();
  const environments = [];

  for (const site of sites) {
    for (const env of site.environments || []) {
      // Only surface the live/production environment, never staging.
      if (env.name !== 'live') continue;

      const domainNames = (env.domains || []).map(d => d.name).filter(Boolean);
      const primaryDomain =
        env.primaryDomain?.name || domainNames[0] || null;

      const searchParts = [
        site.display_name,
        site.name,
        ...domainNames
      ].filter(Boolean);

      environments.push({
        environmentId: env.id,
        siteName: site.display_name || site.name,
        primaryDomain,
        domains: domainNames,
        // Everything a user might type, lowercased for case-insensitive match.
        searchText: searchParts.join(' ').toLowerCase()
      });
    }
  }

  return environments;
}

async function clearSiteCache(environmentId) {
  const response = await kinstaApiClient.post('/sites/tools/clear-cache', {
    environment_id: environmentId
  });
  // 202 Accepted -> body contains operation_id for status polling.
  return response.data;
}

async function getOperationStatus(operationId) {
  // getOperationStatus resolves for 200/202 and rejects (throws) for 4xx/5xx,
  // so callers distinguish "in progress" from "failed" via the returned status.
  const response = await kinstaApiClient.get(
    `/operations/${encodeURIComponent(operationId)}`,
    // Treat 202 as a normal (non-error) response so axios doesn't throw while
    // the operation is still running.
    { validateStatus: status => status === 200 || status === 202 }
  );
  return response.data; // { status, message, data }
}

/**
 * Poll an operation until it completes, fails, or the time budget runs out.
 * Resolves:
 *   { success: true }                        on 200 (confirmed done)
 *   { success: false, message }              on a definite failure (500/404)
 *   { success: false, timedOut: true, ... }  if still in progress at the deadline
 * Never throws — polling errors are folded into the result.
 */
async function pollOperation(operationId, {
  intervalMs = 2000,
  timeoutMs = 30000
} = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const result = await getOperationStatus(operationId);
      if (result.status === 200) {
        return { success: true, message: result.message };
      }
      // status 202 -> still in progress, keep polling.
    } catch (error) {
      // 404 (not found yet / no permission) or 500 (failed) -> stop polling.
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      if (status === 500 || status === 404) {
        return { success: false, message };
      }
      // Any other transient error: fall through and retry until the deadline.
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return {
    success: false,
    timedOut: true,
    message: 'Still processing at the polling deadline.'
  };
}

module.exports = {
  kinstaApiClient,
  getCompanyId,
  getSites,
  getLiveEnvironments,
  clearSiteCache,
  getOperationStatus,
  pollOperation
};
