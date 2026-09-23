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
// The admin page's Stocks tab can also start a run by hand (?trigger=admin, checked against the same
// ADMIN_KEY every other admin write uses), for the two cases the schedule cannot cover: the cron did
// not reach every company before its budget or the provider ran out, or somebody just followed a new
// company and does not want to wait for tomorrow's sweep. It is the same sweep either way - fresh
// companies only (freshTodayKeys), most-followed first, stopped by the same per-market budget - so a
// manual click can only ever finish today's work sooner, never fetch a company twice or spend past the
// day's plan.
//
// It is also the twelfth function on a plan that allows twelve. Anything else that needs an endpoint
// has to share an existing one.
import { getPool } from '../lib/db.js';
import { trimArticles, marketauxUrl } from '../lib/news.js';
import { sanitizeForCompany } from '../lib/newsfilter.js';
import { ensureNewsTables, writeDay, freshTodayKeys, companiesForMarket, setSweepState,
  sweep, noteProviderFailure, clearProviderFailure, claimFetch, releaseClaim } from '../lib/newsstore.js';
import { isMarket, parseBudget, budgetForMarket, cronAuthorized, planSweep, runSweep, SWEEP_SKIP } from '../lib/cron.js';
import { requireAdmin } from '../lib/admin.js';

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  const isCron = cronAuthorized(req.headers && req.headers.authorization, process.env.CRON_SECRET);
  // The query flag keeps this endpoint closed to a bare GET even when no ADMIN_KEY is set (the rest of
  // the admin page is open then, by the owner's own choice - see lib/admin.js): a request still has to
  // say plainly that it means to spend a provider call, not just happen to satisfy requireAdmin().
  const isManual = !isCron && req.query && req.query.trigger === 'admin' && requireAdmin(req) === null;
  if (!isCron && !isManual) return json(res, 401, { error: 'unauthorized' });
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

    const claims = new Map();
    const out = await runSweep({
      todo,
      fetchOne: async (c) => {
        // The same claim a phone takes (lib/newsstore.js claimFetch): if somebody is fetching this company
        // right now, or finished it since the sweep began, it is skipped rather than paid for twice.
        const claim = await claimFetch(pool, c.name);
        if (claim.state !== 'won') return SWEEP_SKIP;
        const r = await fetch(marketauxUrl(c.name, key)).catch(() => null);
        // null means "the provider refused", which runSweep counts and eventually stops on. An empty
        // array means "no news for this company today", which is an answer and gets archived as one.
        if (!r || !r.ok) { await releaseClaim(pool, claim); return null; }
        claims.set(c.nameKey, claim);
        // Same sanitising as the on-demand path: the sweep must not fill the archive with articles
        // that never name the company, or with rows carrying no sentiment.
        return sanitizeForCompany(trimArticles(await r.json()), c.name);
      },
      onWrite: async (c, articles) => { await writeDay(pool, c.name, articles); await releaseClaim(pool, claims.get(c.nameKey)); },
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
      busy: out.busy,
      skipped,
      budget,
      stopped: out.stopped,
    };
    // A manual run only ever updates the sweep record when it moved it forward - never with 0 attempted,
    // so pressing "Sync" on an already-covered market cannot make the admin page's "checked today" line
    // look wrong by overwriting a real 08:30/18:30 run with a no-op timestamp.
    if (isCron || todo.length) await setSweepState(pool, market, state);
    sweep(pool);                       // drop archive days past the retention window
    return json(res, 200, { ok: true, market, manual: isManual, ...state });
  } catch (_) {
    return json(res, 503, { error: 'sweep failed' });
  }
}
