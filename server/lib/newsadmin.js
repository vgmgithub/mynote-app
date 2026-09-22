// newsadmin.js — the archive, shaped the way the app's Feed shows it, for the admin page.
//
// Same reading as a phone gets: one card per company, a sentiment verdict per day, and today split
// from the whole window. The difference worth knowing is that the app filters each article against
// the user's OWN typed holding name (feed.js parseDay: entity match, then a text mention) before
// scoring it. Nothing here can do that - the archive is keyed by company name alone and there is no
// holding to check against - so this scores what was stored for that name. The admin view therefore
// answers "what did we collect for this company", not "what would a particular person see".
//
// Pure: rows in, shape out. No database, no network.
import { dayStr } from './news.js';

// Same thresholds the app uses, so a day that reads negative on a phone reads negative here.
export const POS = 0.15;
export const NEG = -0.15;

export function articleSentiment(article, companyName) {
  // Scored once on the way in (lib/newsfilter.js sanitizeForCompany) and stored with the article, so
  // every reader agrees. Rows written before that existed have no `sentiment` and fall through to the
  // entity read below - which is what they were shaped by at the time.
  if (article && Number.isFinite(Number(article.sentiment))) return Number(article.sentiment);
  const ents = Array.isArray(article && article.entities) ? article.entities : [];
  if (!ents.length) return 0;
  const want = String(companyName || '').toLowerCase();
  // The entity for THIS company first, so the score is how this company was covered rather than an
  // average diluted across everyone else mentioned in the same piece.
  const mine = ents.find((e) => {
    const n = String((e && e.name) || '').toLowerCase();
    return n && (n === want || want.includes(n) || n.includes(want));
  });
  const pick = mine || null;
  if (pick && pick.sentiment_score != null) return Number(pick.sentiment_score) || 0;
  const scored = ents.map((e) => Number(e && e.sentiment_score)).filter((n) => Number.isFinite(n));
  if (!scored.length) return 0;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

// Majority vote over a day's articles, exactly as the app's dot timeline decides its colour.
export function dayVerdict(articles, companyName) {
  let pos = 0, neg = 0;
  for (const a of articles || []) {
    const s = articleSentiment(a, companyName);
    if (s > POS) pos++; else if (s < NEG) neg++;
  }
  return { pos, neg, neu: (articles || []).length - pos - neg, sentiment: pos > neg ? 'pos' : neg > pos ? 'neg' : 'neu' };
}

const parsePayload = (p) => {
  if (Array.isArray(p)) return p;
  try { const v = JSON.parse(p); return Array.isArray(v) ? v : []; } catch (_) { return []; }
};

// `day` is a MySQL DATE, and mysql2 hands those back as JS Date objects rather than strings (the
// pool in lib/db.js does not set dateStrings). Everything below compares, sorts and slices `day` as
// a 'YYYY-MM-DD' string, so a Date silently breaks all three: nothing ever equals today, the sort
// falls back to comparing "Tue Sep 22 2026..." by weekday name, and the dot label only looks right
// by coincidence. Normalised here, at the boundary rows arrive at, so every caller is safe - the
// same thing readArchive already does in lib/newsstore.js.
const asDay = (v) => {
  if (typeof v === 'string') return v.slice(0, 10);
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? dayStr(t) : '';
};

// `rows` are news_archive rows (name_key, day, name, payload, fetched_at); `followers` maps a
// name_key to how many people follow it. Newest day first inside each company; companies ordered by
// who has news today first, then by followers - so the admin page opens on what is actually moving.
export function shapeNewsAdmin(rows, followers = new Map(), today = new Date().toISOString().slice(0, 10)) {
  const byCompany = new Map();
  for (const r of rows || []) {
    const key = r.name_key;
    if (!byCompany.has(key)) {
      byCompany.set(key, { nameKey: key, name: r.name || key, followers: Number(followers.get(key)) || 0, days: [] });
    }
    const c = byCompany.get(key);
    if (r.name) c.name = r.name;
    const articles = parsePayload(r.payload);
    c.days.push({
      day: asDay(r.day),
      fetchedAt: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
      count: articles.length,
      ...dayVerdict(articles, c.name),
      articles: articles.map((a) => ({
        title: String((a && a.title) || ''),
        source: String((a && a.source) || ''),
        url: String((a && a.url) || ''),
        publishedAt: (a && a.published_at) || null,
        sentiment: articleSentiment(a, c.name),
      })),
    });
  }

  const out = [];
  for (const c of byCompany.values()) {
    c.days.sort((a, b) => String(b.day).localeCompare(String(a.day)));
    const todayDay = c.days.find((d) => d.day === today) || null;
    c.todayCount = todayDay ? todayDay.count : 0;
    // A day the sweep fetched and found nothing for is still a day we checked - worth telling apart
    // from a company nobody has looked at at all.
    c.checkedToday = !!todayDay;
    c.total = c.days.reduce((n, d) => n + d.count, 0);
    const all = c.days.flatMap((d) => d.articles);
    c.verdict = dayVerdict(all.map((a) => ({ entities: [{ name: c.name, sentiment_score: a.sentiment }] })), c.name).sentiment;
    out.push(c);
  }
  out.sort((a, b) => b.todayCount - a.todayCount || b.followers - a.followers || a.name.localeCompare(b.name));
  return {
    today,
    companies: out,
    totals: {
      companies: out.length,
      withNewsToday: out.filter((c) => c.todayCount > 0).length,
      checkedToday: out.filter((c) => c.checkedToday).length,
      articlesToday: out.reduce((n, c) => n + c.todayCount, 0),
      articles: out.reduce((n, c) => n + c.total, 0),
    },
  };
}
