// GET /api/cron-news?market=in|us — the nightly sweep, run by Vercel's scheduler.
//
// India runs at 08:30 IST (03:00 UTC) and the US at 18:30 IST (13:00 UTC), the owner's chosen times and the
// same as the app's own sync anchors (feed.js FEED_ANCHORS). Vercel Hobby fires a daily cron anywhere
// within its hour, so a run lands between :30 and :29 past the next hour, never early; a phone that asks
// before it has run fetches that company itself, and the sweep then skips it (freshTodayKeys).
//
// This endpoint SPENDS MONEY every time it runs: one upstream request per company. It is therefore
// refused outright unless the caller presents CRON_SECRET, and the number of requests one run may
// make is capped by NEWS_DAILY_BUDGET rather than by how many companies happen to exist.
//
// It is also the twelfth function on a plan that allows twelve. Anything else that needs an endpoint
// has to share an existing one.
import { getPool } from '../lib/db.js';
import { trimArticles, marketauxUrl } from '../lib/news.js';
import { sanitizeForCompany } from '../lib/newsfilter.js';
import { ensureNewsTables, writeDay, freshTodayKeys, companiesForMarket, setSweepState,
  sweep, noteProviderFailure, clearProviderFailure } from '../lib/newsstore.js';
import { isMarket, parseBudget, budgetForMarket, cronAuthorized, planSweep, runSweep } from '../lib/cron.js';

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (!cronAuthorized(req.headers && req.headers.authorization, process.env.CRON_SECRET)) {
    return json(res, 401, { error: 'unauthorized' });
  }
  const market = String((req.query && req.query.market) || '');
  if (!isMarket(market)) return json(res, 400, { error: 'bad market' });

  const key = process.env.MARKETAUX_KEY;
  if (!key) return json(res, 503, { error: 'news is not configured on this server' });

  const startedAt = new Date();
  try {
    const pool = await getPool();
    await ensureNewsTables(pool);

    const budget = budgetForMarket(market, parseBudget(process.env.NEWS_DAILY_BUDGET));
    const [companies, fresh] = await Promise.all([companiesForMarket(pool, market), freshTodayKeys(pool)]);
    const { todo, skipped } = planSweep(companies, fresh, budget);

    const out = await runSweep({
      todo,
      fetchOne: async (c) => {
        const r = await fetch(marketauxUrl(c.name, key));
        // null means "the provider refused", which runSweep counts and eventually stops on. An empty
        // array means "no news for this company today", which is an answer and gets archived as one.
        if (!r || !r.ok) return null;
        // Same sanitising as the on-demand path: the sweep must not fill the archive with articles
        // that never name the company, or with rows carrying no sentiment.
        return sanitizeForCompany(trimArticles(await r.json()), c.name);
      },
      onWrite: (c, articles) => writeDay(pool, c.name, articles),
    });

    if (out.stopped) await noteProviderFailure(pool);
    else if (out.fetched || out.empty) await clearProviderFailure(pool);

    // What the app reads to say "today's news is ready" without spending a call to find out.
    const state = {
      day: startedAt.toISOString().slice(0, 10),
      at: startedAt.toISOString(),
      companies: companies.length,
      attempted: todo.length,
      fetched: out.fetched,
      empty: out.empty,
      failed: out.failed,
      skipped,
      budget,
      stopped: out.stopped,
    };
    await setSweepState(pool, market, state);
    sweep(pool);                       // drop archive days past the retention window
    return json(res, 200, { ok: true, market, ...state });
  } catch (_) {
    return json(res, 503, { error: 'sweep failed' });
  }
}
