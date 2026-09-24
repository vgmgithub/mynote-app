// The news proxy's pure parts: what a request may ask for, what is kept, and for how long.
//
// The Marketaux key lives ONLY in the server environment. The app never sees it, which is the whole
// point of this endpoint - a key handed to the app would be readable by anyone with devtools, and the
// free tier's 100 requests a day would be spent by the first two or three people to open the Feed.
//
// What is kept, and what is deliberately not:
//   news_cache  - articles keyed by the stock NAME alone. No install id, so the server cannot build a
//                 record of who holds what. Cached names are public company names, not anybody's holding.
//   news_quota  - one COUNT per install per day, for the rate limit. A number, never a name.

// 12 hours, the same window the app's own feed cache uses, so a refresh inside it costs nothing upstream.
export const NEWS_TTL_MS = 12 * 60 * 60 * 1000;
// One portfolio is around 30 stocks. This allows a full refresh twice over in a day and still leaves the
// shared quota for everyone else; a day already in the archive does not count, so normal use rarely
// comes near it. Raise this when a paid provider key is in place - it is the only number to change.
export const DAILY_LIMIT = 80;
// How many days of news the archive keeps, and the furthest back a client may ask for. Somebody who
// does not open the app for a few days gets the days they missed, rather than a hole in the record.
export const ARCHIVE_DAYS = 10;
// When the provider refuses (quota spent, key rejected, outage), stop asking for a while.
//
// Without this, every sync from every phone keeps hammering a provider that is already saying no, and
// each of those refusals still counts against the daily allowance. A bad key or an exhausted quota
// could burn a whole day's requests in minutes - which is exactly what happened on 21 Sep 2026.
// 30 minutes is long enough to stop the bleeding and short enough that a fixed key works again almost
// straight away. A quota that resets at midnight is covered by the daily counter, not by this.
export const PROVIDER_BACKOFF_MS = 30 * 60 * 1000;
// Marketaux tags each entity it finds in an article with its own match_score - "the overall strength
// of the matching for the identified entity" (their docs), a decimal that is NOT bounded to 0-1 or
// 0-100; real examples run roughly 10-85. A low one is the company's name appearing in passing (a
// boilerplate "also mentioned" list, a footer of tickers) rather than the article actually being about
// it. Asked for upstream via min_match_score so a weak match never costs an archive slot or a read in
// the Feed, and checked again in newsfilter.js's sanitizeForCompany as a second, independent gate.
export const MIN_MATCH_SCORE = 30;

export const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

// `since` is clamped rather than refused: an app that has been shut for a month asks for a month and
// gets the ten days that exist, instead of an error it cannot do anything about.
export function clampSince(since, now = Date.now()) {
  const oldest = dayStr(now - (ARCHIVE_DAYS - 1) * 86400000);
  if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return oldest;
  return since < oldest ? oldest : (since > dayStr(now) ? dayStr(now) : since);
}

const INSTALL_ID = /^[0-9a-f-]{32,36}$/;
// A company name: letters, digits, spaces and the handful of marks real names carry. Anything else is a
// sign the caller is not the app, so it is refused rather than passed upstream.
const NAME_OK = /^[\p{L}\p{N} .,&'()\-]{2,80}$/u;

export const fail = (error) => ({ ok: false, error });

// 'in' or 'us', and nothing else reaches the database. It says which nightly sweep owns the company,
// not where it is listed, so anything unrecognised is simply absent rather than an error - a request
// from an older app that does not send one must still work.
export function parseMarket(raw) {
  return raw === 'in' || raw === 'us' ? raw : null;
}

export function parseNewsQuery(query = {}) {
  const name = typeof query.name === 'string' ? query.name.trim().replace(/\s+/g, ' ') : '';
  if (!NAME_OK.test(name)) return fail('bad name');
  const installId = typeof query.installId === 'string' ? query.installId : '';
  if (!INSTALL_ID.test(installId)) return fail('bad installId');
  return { ok: true, value: {
    name, installId, cacheKey: cacheKeyFor(name),
    since: clampSince(query.since), market: parseMarket(query.market),
  } };
}

// One cache entry per company however it was typed: case and surrounding punctuation should not split
// the cache and cost a second upstream call for the same company.
export function cacheKeyFor(name) {
  return String(name).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export const isFresh = (fetchedAt, now = Date.now()) =>
  fetchedAt != null && now - new Date(fetchedAt).getTime() < NEWS_TTL_MS;

// Marketaux returns far more than the app reads. Only these fields are stored, so the cache stays small
// and nothing is kept that the Feed does not actually use.
export function trimArticles(data) {
  return (Array.isArray(data && data.data) ? data.data : []).slice(0, 3).map((a) => ({
    title: String(a.title || '').slice(0, 300),
    description: String(a.description || a.snippet || '').slice(0, 600),
    source: String(a.source || '').slice(0, 80),
    url: String(a.url || '').slice(0, 500),
    published_at: String(a.published_at || '').slice(0, 40),
    entities: (Array.isArray(a.entities) ? a.entities : []).slice(0, 8).map((e) => ({
      name: String(e.name || '').slice(0, 120),
      symbol: String(e.symbol || '').slice(0, 30),
      sentiment_score: e.sentiment_score == null ? null : Number(e.sentiment_score),
      match_score: e.match_score == null ? null : Number(e.match_score),
    })),
  }));
}

// ---- Which stocks people follow ----
//
// The popularity figures answer one question only: which companies do people follow, and how many
// follow each one. Which person follows which stock is not wanted and is deliberately not knowable.
//
// The stored `follower` is a one-way hash of four things: the install id, a server secret, the week AND
// the company itself. Each part rules something out:
//   install id + secret  - the value cannot be worked back to an install by trying ids.
//   week                 - the same person is a different value next week, so weeks cannot be joined
//                          into a history of what somebody holds.
//   the company          - the same person is a DIFFERENT value for each stock, so the rows can never
//                          be grouped into "this anonymous person follows Reliance and TCS". There is no
//                          basket to find, only a per-company tally.
// Counting still works exactly: within one week and one company, a person is one stable value, so
// COUNT(DISTINCT follower) is the number of distinct people following that company.
export function weekKey(now = new Date()) {
  // ISO week, so a week is the same seven days for everyone regardless of time zone.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - start) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

export async function installHash(installId, secret, week, nameKey, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  const data = new TextEncoder().encode(week + '|' + secret + '|' + installId + '|' + nameKey);
  const digest = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The upstream call. `published_after` keeps it to the last 24 hours, exactly as the app asked for it
// when it still held the key itself.
export function marketauxUrl(name, key, now = Date.now()) {
  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const params = new URLSearchParams({
    api_token: key,
    search: name,
    filter_entities: 'true',
    min_match_score: String(MIN_MATCH_SCORE),
    language: 'en',
    limit: '3',
    published_after: since,
  });
  return 'https://api.marketaux.com/v1/news/all?' + params.toString();
}
