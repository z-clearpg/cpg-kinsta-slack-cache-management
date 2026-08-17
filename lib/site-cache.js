// Persistent cache of the processed live-environment list, backed by Netlify
// Blobs. A scheduled function refreshes it daily so the bot never waits on the
// Kinsta API (validate + sites + parsing) during a user interaction.
//
// Blobs is only available inside the Netlify runtime; outside it (local
// `index.js`, tests) every function here degrades gracefully to a no-op so the
// caller falls back to a live fetch.
const { getLiveEnvironments } = require('./kinsta');

const STORE_NAME = 'site-cache';
const CACHE_KEY = 'live-environments';

// Consider the cache stale after this long. The daily cron refreshes well
// within this window; the TTL only matters if a refresh is missed.
const MAX_AGE_MS = 36 * 60 * 60 * 1000; // 36h

function getStoreSafe() {
  try {
    // Lazy require so environments without the package/runtime don't crash.
    const { getStore } = require('@netlify/blobs');

    // In some Netlify function contexts the Blobs config isn't auto-injected, so
    // getStore() throws "environment has not been configured". Supply siteID and
    // a token manually from the runtime env when they're available. Netlify
    // exposes the site id and an API token via these env vars.
    // NETLIFY_SITE_ID is auto-available at runtime; the token must be a Netlify
    // Personal Access Token supplied as an env var (NETLIFY_API_TOKEN).
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;

    const opts = { name: STORE_NAME, consistency: 'strong' };
    if (siteID && token) {
      opts.siteID = siteID;
      opts.token = token;
    }

    // Strong consistency so a read in one function immediately sees a write from
    // another (e.g. the scheduled refresh). With the default eventual
    // consistency, writes take up to 60s to propagate and the picker would read
    // stale/empty data right after a refresh.
    return getStore(opts);
  } catch (error) {
    // Blobs unavailable/misconfigured (local dev, tests, or missing runtime
    // credentials). Log so we can tell "no store" apart from "empty store".
    console.error('site-cache: getStore unavailable:', error.message);
    return null;
  }
}

/**
 * Read the cached environment list. Returns { environments, cachedAt, stale }
 * or null when there is no usable cache (no store, empty, or unreadable).
 */
async function readCachedEnvironments() {
  const store = getStoreSafe();
  if (!store) return null;

  try {
    const entry = await store.get(CACHE_KEY, { type: 'json' });
    if (!entry || !Array.isArray(entry.environments)) return null;

    const cachedAt = entry.cachedAt || 0;
    const stale = Date.now() - cachedAt > MAX_AGE_MS;
    return { environments: entry.environments, cachedAt, stale };
  } catch (error) {
    console.error('site-cache: read failed:', error.message);
    return null;
  }
}

/**
 * Fetch fresh live environments from Kinsta and write them to the cache.
 * Returns the freshly fetched list. Throws if the Kinsta fetch fails (so the
 * scheduled refresh surfaces the error); a write failure is logged, not thrown.
 */
async function refreshCachedEnvironments() {
  const environments = await getLiveEnvironments();

  const store = getStoreSafe();
  if (store) {
    try {
      await store.setJSON(CACHE_KEY, {
        environments,
        cachedAt: Date.now()
      });
      console.log(`site-cache: wrote ${environments.length} environments`);
    } catch (error) {
      console.error('site-cache: write failed:', error.message);
    }
  } else {
    console.log('site-cache: no store available, skipping write');
  }

  return environments;
}

/**
 * The function handlers call this. Prefers the cache; falls back to a live
 * fetch (and repopulates the cache) when the cache is missing or stale, so the
 * bot always works even if the scheduled refresh hasn't run or failed.
 */
async function getLiveEnvironmentsFast() {
  const cached = await readCachedEnvironments();
  console.log('site-cache: read',
    cached ? `hit count=${cached.environments.length} stale=${cached.stale}` : 'miss (no store/empty)');
  // Trust the cache only if it's fresh AND non-empty. An empty result is treated
  // as a miss so a transient upstream failure can't poison the cache for hours.
  if (cached && !cached.stale && cached.environments.length > 0) {
    return cached.environments;
  }

  try {
    // Miss or stale -> refresh live (also updates the cache for next time).
    console.log('site-cache: refreshing live from Kinsta');
    return await refreshCachedEnvironments();
  } catch (error) {
    // Live fetch failed. If we have *stale* data, better to serve it than
    // nothing; otherwise re-throw so the caller can report the failure.
    if (cached) {
      console.error('site-cache: live refresh failed, serving stale cache:', error.message);
      return cached.environments;
    }
    throw error;
  }
}

module.exports = {
  readCachedEnvironments,
  refreshCachedEnvironments,
  getLiveEnvironmentsFast,
  STORE_NAME,
  CACHE_KEY,
  MAX_AGE_MS
};
