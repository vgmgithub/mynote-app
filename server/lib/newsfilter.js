// newsfilter.js — is this article really about this company, and how does it read?
//
// TWO JOBS, BOTH DONE BEFORE ANYTHING IS STORED.
//
//   1. RELEVANCE. Marketaux is asked with `search=<company>` and answers with whatever its index
//      matched, which is not always the company. A real example from the archive: "Thrivent Financial
//      for Lutherans Trims Gloo Holdings Inc (GLOO) Stake by 1.40%" came back under Amazon. Storing
//      that spends archive space on a row every reader then has to mentally discard. An article now
//      has to actually name the company to be kept.
//
//   2. SENTIMENT. Marketaux's free tier returns `entities: []` for these queries, so there is no
//      sentiment_score to read - which is why every company showed as Neutral. The app has always
//      coped by scoring the words itself (applyKeywordSentiment in feed.js) and never needed the
//      provider. Doing the same here costs nothing extra: it is text we already have, scored once on
//      the way in rather than again in every reader.
//
// These rules are a port of the app's own, which have been filtering the Feed since before the news
// went through this server. A test reads both files and fails if the word lists drift apart, because
// two different answers for one article is worse than either answer on its own.

import { MIN_MATCH_SCORE } from './news.js';

export const POSITIVE_WORDS = new Set([
  'beat', 'beats', 'beating', 'growth', 'grew', 'growing', 'surge', 'surged',
  'outperform', 'outperformed', 'raised', 'raise', 'expand', 'expanded',
  'record', 'rally', 'rallied', 'upgrade', 'upgraded', 'profit', 'profits',
  'gain', 'gains', 'gained', 'approves', 'approved', 'wins', 'won',
  'milestone', 'success', 'successful', 'strong', 'robust', 'positive',
  'jump', 'jumped', 'climb', 'climbed', 'rise', 'rose', 'boost', 'boosted',
  'exceeds', 'exceeded', 'higher', 'best', 'better', 'launch', 'launched',
]);

export const NEGATIVE_WORDS = new Set([
  'miss', 'missed', 'misses', 'decline', 'declined', 'declining',
  'fall', 'fell', 'falling', 'downgrade', 'downgraded', 'loss', 'losses',
  'fraud', 'investigation', 'investigated', 'delisting', 'delisted',
  'bankruptcy', 'bankrupt', 'scam', 'warning', 'regulatory', 'fine',
  'fined', 'penalty', 'penalized', 'plunge', 'plunged', 'slump', 'slumped',
  'crash', 'crashed', 'weak', 'weakness', 'concern', 'concerned',
  'worry', 'worries', 'lawsuit', 'sued', 'probe', 'raid', 'lower', 'worst',
]);

// "Bharat Electronics Limited" -> "bharat electronics". Legal suffixes go, so the same company typed
// three ways still matches one article.
export function normCompanyName(s) {
  return (s || '').toLowerCase()
    .replace(/\b(ltd|limited|corp|corporation|inc|co|pvt|private|plc|llc|group|holdings?)\b\.?/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Does this text actually name the company? The full name first, then its distinctive first word as
// a whole word - "Infosys" matches "Infosys Ltd", but "co" never matches half the internet, which is
// why the short form needs three characters before it counts.
export function mentionsCompany(text, companyName) {
  const norm = normCompanyName(text);
  const sName = normCompanyName(companyName);
  if (!norm || !sName) return false;
  if (norm.includes(sName)) return true;
  const shortForm = sName.split(' ')[0];
  if (shortForm && shortForm.length >= 3) {
    const re = new RegExp('\\b' + shortForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(norm)) return true;
  }
  return false;
}

// -1 .. 1 from the words alone. Normalised by /5 so a 25-word headline carrying three negative words
// lands near -0.6 rather than being drowned by its own length.
export function keywordSentiment(text) {
  if (!text) return 0;
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  if (!words.length) return 0;
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos++;
    if (NEGATIVE_WORDS.has(w)) neg++;
  }
  const score = (pos - neg) / Math.max(1, words.length / 5);
  return Math.max(-1, Math.min(1, score));
}

const articleText = (a) => String((a && a.title) || '') + ' ' + String((a && (a.description || a.snippet)) || '');

// An article's own sentiment: the provider's entity score when there is one, the words when there is
// not. Today it is always the words, because the free tier sends no entities - but a paid tier would
// start sending them and this would use them without another change.
export function scoreArticle(article, companyName) {
  const ents = Array.isArray(article && article.entities) ? article.entities : [];
  const want = normCompanyName(companyName);
  const mine = ents.find((e) => {
    const n = normCompanyName((e && e.name) || '');
    return n && (n === want || want.includes(n) || n.includes(want));
  });
  if (mine && mine.sentiment_score != null && Number.isFinite(Number(mine.sentiment_score))) {
    return Number(mine.sentiment_score);
  }
  return keywordSentiment(articleText(article));
}

// What actually gets written for a day: only articles that name the company, each carrying the score
// it was given on the way in. Everything else is dropped here rather than stored and skipped later by
// every reader in turn.
export function sanitizeForCompany(articles, companyName) {
  const out = [];
  for (const a of articles || []) {
    if (!a || typeof a !== 'object') continue;
    // An article tagged with entities that include this company is about it, whatever the wording -
    // unless marketaux itself says the match was weak (match_score below MIN_MATCH_SCORE), which reads
    // as the company's name appearing in passing (a "also mentioned" list, a footer of tickers) rather
    // than the article being about it. The upstream request already asks for MIN_MATCH_SCORE or better
    // (lib/news.js marketauxUrl), so this is the second, independent check on what actually came back -
    // an old cached article, or a future change to that request, never bypasses it.
    // With no entity tag at all, the text itself has to name it.
    const ents = Array.isArray(a.entities) ? a.entities : [];
    const taggedMine = ents.find((e) => mentionsCompany((e && e.name) || '', companyName));
    const weaklyMatched = taggedMine && taggedMine.match_score != null
      && Number.isFinite(Number(taggedMine.match_score)) && Number(taggedMine.match_score) < MIN_MATCH_SCORE;
    // A strong (or unscored) tag is enough on its own. A weak one still counts if the wording itself
    // names the company - only a weak tag with nothing in the text to back it up is dropped.
    if ((!taggedMine || weaklyMatched) && !mentionsCompany(articleText(a), companyName)) continue;
    out.push({ ...a, sentiment: scoreArticle(a, companyName) });
  }
  return out;
}
