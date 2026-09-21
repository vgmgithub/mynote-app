// GET /api/news?name=<company>&installId=<id> -> the last 24 hours of news for one company.
//
// This endpoint exists so the Marketaux key can live on the server and nowhere else. The app used to
// hold the user's own key and call Marketaux directly; now it asks here, and the key never leaves the
// server environment.
//
// Nothing links a company to a person: the cache is keyed by the company name alone, and the only
// per-install row is a counter for the daily limit. No name is ever logged.
import { getPool } from '../lib/db.js';
import { parseNewsQuery, trimArticles, marketauxUrl, DAILY_LIMIT } from '../lib/news.js';
import { ensureNewsTables, readArchive, todayIsFresh, writeDay, takeQuota, sweep, recordStockUse } from '../lib/newsstore.js';

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

  const parsed = parseNewsQuery(req.query || {});
  if (!parsed.ok) return json(res, 400, { error: parsed.error });
  const { name, installId, since } = parsed.value;

  const key = process.env.MARKETAUX_KEY;
  if (!key) return json(res, 503, { error: 'news is not configured on this server' });

  try {
    const pool = await getPool();
    await ensureNewsTables(pool);

    // Which companies people follow, counted against a weekly one-way hash rather than the install.
    // This runs on a cache hit too: it is about who follows what, not about upstream calls.
    await recordStockUse(pool, name, installId);

    // Every archived day from `since`: this is what somebody who has not opened the app for a few days
    // gets back, so the days they were away are filled in rather than lost.
    let days = await readArchive(pool, name, since);

    // Today already fetched recently, by this person or anybody else? Then nothing goes upstream and
    // nothing is counted against them - the archive answers on its own.
    if (todayIsFresh(days)) return json(res, 200, { days, cached: true });

    const quota = await takeQuota(pool, installId, DAILY_LIMIT);
    if (!quota.allowed) {
      // Out of quota is not an error for the reader: the archive still has the days already collected,
      // so the Feed shows those and says today's news will arrive tomorrow.
      return json(res, 200, { days, cached: true, limited: true, used: quota.used, limit: quota.limit });
    }

    let upstream;
    try { upstream = await fetch(marketauxUrl(name, key)); } catch (_) { upstream = null; }
    if (!upstream || !upstream.ok) {
      // The provider is down or rate-limiting us. Same reasoning: hand back what the archive holds
      // rather than nothing. The upstream body is never echoed - it can carry the key back.
      return json(res, 200, { days, cached: true, limited: true, provider: upstream ? upstream.status : 'unreachable' });
    }
    const articles = trimArticles(await upstream.json());
    await writeDay(pool, name, articles);
    sweep(pool);
    days = days.filter((d) => d.day !== new Date().toISOString().slice(0, 10));
    days.push({ day: new Date().toISOString().slice(0, 10), data: articles });
    return json(res, 200, { days, cached: false });
  } catch (_) {
    return json(res, 503, { error: 'news unavailable' });
  }
}
