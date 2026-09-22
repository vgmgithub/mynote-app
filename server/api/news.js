// GET /api/news?name=<company>&installId=<id> -> the last 24 hours of news for one company.
//
// This endpoint exists so the Marketaux key can live on the server and nowhere else. The app used to
// hold the user's own key and call Marketaux directly; now it asks here, and the key never leaves the
// server environment.
//
// Nothing links a company to a person: the cache is keyed by the company name alone, and the only
// per-install row is a counter for the daily limit. No name is ever logged.
//
// CORS matters here as much as on any other app-facing endpoint, and its absence was invisible for a
// long time: the app and the server are different origins, so without the header below the browser
// fetches, the SERVER does all its work and archives the day - and then the browser throws the answer
// away unread. Every company then counts as an error, the "last synced" stamp is never written, and
// the Feed sits at "last synced N days ago" while the archive quietly fills up behind it.
import { getPool } from '../lib/db.js';
import { matchOrigin } from '../lib/cors.js';
import { parseNewsQuery, parseMarket, trimArticles, marketauxUrl, DAILY_LIMIT } from '../lib/news.js';
import { sanitizeForCompany } from '../lib/newsfilter.js';
import { ensureNewsTables, readArchive, todayIsFresh, writeDay, takeQuota, sweep, recordStockUse,
  providerBlocked, noteProviderFailure, clearProviderFailure, getSweepState } from '../lib/newsstore.js';

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  const origin = matchOrigin(req.headers.origin, process.env.ALLOWED_ORIGINS);
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

  const q = req.query || {};

  // "Has the sweep run for my market today?" — read-only, no name, no quota, no upstream call. This is
  // what lets the app say "today's news is ready" before it starts asking about companies one by one.
  if (q.status === '1') {
    const market = parseMarket(q.market);
    if (!market) return json(res, 400, { error: 'bad market' });
    try {
      const pool = await getPool();
      await ensureNewsTables(pool);
      const state = await getSweepState(pool, market);
      const today = new Date().toISOString().slice(0, 10);
      return json(res, 200, { market, ready: !!(state && state.day === today), sweep: state || null });
    } catch (_) {
      return json(res, 503, { error: 'news unavailable' });
    }
  }

  const parsed = parseNewsQuery(q);
  if (!parsed.ok) return json(res, 400, { error: parsed.error });
  const { name, installId, since, market } = parsed.value;

  const key = process.env.MARKETAUX_KEY;
  if (!key) return json(res, 503, { error: 'news is not configured on this server' });

  try {
    const pool = await getPool();
    await ensureNewsTables(pool);

    // Which companies people follow, counted against a weekly one-way hash rather than the install.
    // This runs on a cache hit too: it is about who follows what, not about upstream calls.
    // The market comes along so the nightly sweep knows which of its two runs owns this company.
    await recordStockUse(pool, name, installId, new Date(), market);

    // Every archived day from `since`: this is what somebody who has not opened the app for a few days
    // gets back, so the days they were away are filled in rather than lost.
    let days = await readArchive(pool, name, since);

    // Today already fetched recently, by this person or anybody else? Then nothing goes upstream and
    // nothing is counted against them - the archive answers on its own.
    if (todayIsFresh(days)) return json(res, 200, { days, cached: true });

    // The provider refused us recently, so do not ask again yet - and do not spend this install's
    // quota on a call that is going to be refused. The archive answers instead.
    if (await providerBlocked(pool)) return json(res, 200, { days, cached: true, limited: true, backoff: true });

    const quota = await takeQuota(pool, installId, DAILY_LIMIT);
    if (!quota.allowed) {
      // Out of quota is not an error for the reader: the archive still has the days already collected,
      // so the Feed shows those and says today's news will arrive tomorrow.
      return json(res, 200, { days, cached: true, limited: true, used: quota.used, limit: quota.limit });
    }

    let upstream;
    try { upstream = await fetch(marketauxUrl(name, key)); } catch (_) { upstream = null; }
    if (!upstream || !upstream.ok) {
      // The provider is down or rate-limiting us. Start the cool-off so the next few minutes of syncs
      // from every phone do not keep asking a provider that is already saying no. Hand back what the
      // archive holds rather than nothing. The upstream body is never echoed - it can carry the key back.
      await noteProviderFailure(pool);
      return json(res, 200, { days, cached: true, limited: true, provider: upstream ? upstream.status : 'unreachable' });
    }
    // Sanitised before it is stored, not after it is read: the provider answers a `search=` with
    // whatever its index matched, which is not always this company. Anything that does not actually
    // name it is dropped here, and what is kept carries the sentiment it was scored with.
    const articles = sanitizeForCompany(trimArticles(await upstream.json()), name);
    await writeDay(pool, name, articles);
    await clearProviderFailure(pool);   // it works again: let everyone through immediately
    sweep(pool);
    days = days.filter((d) => d.day !== new Date().toISOString().slice(0, 10));
    days.push({ day: new Date().toISOString().slice(0, 10), data: articles });
    return json(res, 200, { days, cached: false });
  } catch (_) {
    return json(res, 503, { error: 'news unavailable' });
  }
}
