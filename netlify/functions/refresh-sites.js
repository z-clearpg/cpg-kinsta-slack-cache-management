// Scheduled function: rebuilds the cached live-environment list once a day so
// the Slack bot never waits on the Kinsta API during an interaction. The
// schedule is set in netlify.toml ([functions."refresh-sites"]).
//
// It logs a summary to the Netlify function logs each run, which also serves as
// a health check for the Kinsta integration.
const { refreshCachedEnvironments } = require('../../lib/site-cache');

module.exports.handler = async () => {
  const startedAt = Date.now();
  try {
    const environments = await refreshCachedEnvironments();
    const summary = {
      ok: true,
      count: environments.length,
      durationMs: Date.now() - startedAt
    };
    console.log('refresh-sites:', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (error) {
    // Detail to logs only; the cache keeps its previous (stale) value, and the
    // bot's live fallback still covers user requests until the next run.
    console.error('refresh-sites failed:', error.response?.status, error.response?.data || error.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
};
