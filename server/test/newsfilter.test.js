import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normCompanyName, mentionsCompany, keywordSentiment, scoreArticle, sanitizeForCompany,
  POSITIVE_WORDS, NEGATIVE_WORDS } from '../lib/newsfilter.js';

const art = (title, o = {}) => ({ title, description: '', entities: [], ...o });

test('an article has to actually name the company to be kept', () => {
  // The real one that started this: it came back from the provider under a search for Amazon.
  const junk = art('Thrivent Financial for Lutherans Trims Gloo Holdings Inc (GLOO) Stake by 1.40%');
  const real = art('Amazon (AMZN) Bets Higher Pay Can Support its Next Phase of Growth');
  const kept = sanitizeForCompany([junk, real], 'Amazon.com Inc.');
  assert.equal(kept.length, 1);
  assert.match(kept[0].title, /^Amazon/);
});

test('the company is matched however its name was typed', () => {
  assert.equal(normCompanyName('Bharat Electronics Limited'), 'bharat electronics');
  assert.equal(normCompanyName('Amazon.com Inc.'), 'amazon com');
  for (const typed of ['Infosys', 'Infosys Ltd', 'INFOSYS LIMITED']) {
    assert.equal(mentionsCompany('Infosys wins a multi-year deal', typed), true, typed);
  }
  assert.equal(mentionsCompany('Reliance Industries posts record profit', 'Infosys'), false);
});

test('a two-letter short form never matches half the internet', () => {
  // "co" from "Some Co" must not match every article containing the word.
  assert.equal(mentionsCompany('The company said it would cooperate', 'Some Co'), false);
  // Three characters or more is allowed to match as a whole word, but not as a fragment.
  assert.equal(mentionsCompany('BEML bags an order', 'BEML Limited'), true);
  assert.equal(mentionsCompany('Assembled parts shipped', 'BEM Limited'), false, 'not a fragment of another word');
});

test('an article tagged with the company is kept even when the wording never names it', () => {
  const tagged = art('Chipmaker lifts guidance on AI demand', { entities: [{ name: 'Advanced Micro Devices Inc', sentiment_score: 0.5 }] });
  assert.equal(sanitizeForCompany([tagged], 'Advanced Micro Devices Inc').length, 1);
});

// The upstream request already asks marketaux for MIN_MATCH_SCORE or better (lib/news.js), but an
// already-cached article (written before this existed) or a future change to that request must not
// bypass the check - so it is re-applied here, on the entity's own match_score, independently.
test('a weakly-matched entity tag (low match_score) is dropped even though the name is tagged, unless the wording names it too', () => {
  const weak = art('Roundup of stocks also mentioned today', { entities: [{ name: 'Infosys', match_score: 12.1 }] });
  assert.equal(sanitizeForCompany([weak], 'Infosys').length, 0, 'a weak tag alone is not enough');
  const weakButNamed = art('Infosys shares steady in a mixed market', { entities: [{ name: 'Infosys', match_score: 12.1 }] });
  assert.equal(sanitizeForCompany([weakButNamed], 'Infosys').length, 1, 'the wording itself still names it, so it is kept on that basis');
  const strong = art('Chipmaker lifts guidance on AI demand', { entities: [{ name: 'Infosys', match_score: 34.3 }] });
  assert.equal(sanitizeForCompany([strong], 'Infosys').length, 1, 'at or above the threshold, the tag alone is enough');
  const noScore = art('Chipmaker lifts guidance on AI demand', { entities: [{ name: 'Infosys' }] });
  assert.equal(sanitizeForCompany([noScore], 'Infosys').length, 1, 'an older cached article with no match_score at all is not penalised');
});

test('sentiment comes from the words when the provider sends no entities, which is the normal case', () => {
  // Marketaux's free tier returns entities: [] for these searches - the reason every company read
  // Neutral before this existed.
  assert.ok(keywordSentiment('Infosys wins record deal, profit jumps') > 0.15, 'clearly positive');
  assert.ok(keywordSentiment('Shares plunge after fraud probe and downgrade') < -0.15, 'clearly negative');
  assert.equal(keywordSentiment('Company files routine annual statement'), 0, 'nothing either way');
  assert.equal(keywordSentiment(''), 0);
  assert.equal(keywordSentiment(null), 0);
  // Bounded, so one word-stuffed headline cannot swamp a day.
  assert.ok(keywordSentiment('surge surge surge surge surge surge') <= 1);
  assert.ok(keywordSentiment('fraud fraud fraud fraud fraud fraud') >= -1);
});

test('a provider score is preferred when there is one, so a paid tier needs no code change', () => {
  const withEntity = art('Neutral sounding headline', { entities: [{ name: 'Infosys', sentiment_score: 0.9 }] });
  assert.equal(scoreArticle(withEntity, 'Infosys'), 0.9);
  // An entity for somebody else must not be borrowed.
  const other = art('Infosys gains as peer falls', { entities: [{ name: 'Wipro', sentiment_score: -0.8 }] });
  assert.notEqual(scoreArticle(other, 'Infosys'), -0.8);
  // A malformed score falls back to the words rather than storing NaN.
  const bad = art('Infosys wins record deal', { entities: [{ name: 'Infosys', sentiment_score: 'oops' }] });
  assert.ok(Number.isFinite(scoreArticle(bad, 'Infosys')));
});

test('what is stored carries its score, so every reader agrees on it', () => {
  const kept = sanitizeForCompany([art('Infosys wins record deal, profit jumps')], 'Infosys');
  assert.equal(kept.length, 1);
  assert.ok(Number.isFinite(kept[0].sentiment));
  assert.ok(kept[0].sentiment > 0);
  // The original fields survive - this filters and annotates, it does not reshape.
  assert.equal(kept[0].title, 'Infosys wins record deal, profit jumps');
});

test('rubbish in is an empty day, never a crash', () => {
  assert.deepEqual(sanitizeForCompany(null, 'Infosys'), []);
  assert.deepEqual(sanitizeForCompany([null, undefined, 'string', 42], 'Infosys'), []);
  assert.deepEqual(sanitizeForCompany([art('Infosys news')], ''), [], 'no company name matches nothing');
});

// The app has scored the Feed this way since before the news went through this server. Two different
// answers for one article - one on the phone, one in admin - would be worse than either alone.
test('the word lists have not drifted from the app\'s', () => {
  const feed = readFileSync(new URL('../../feed.js', import.meta.url), 'utf8');
  const listIn = (name) => {
    const m = new RegExp(name + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)').exec(feed);
    assert.ok(m, name + ' not found in feed.js');
    return new Set([...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]));
  };
  assert.deepEqual([...listIn('POSITIVE_WORDS')].sort(), [...POSITIVE_WORDS].sort());
  assert.deepEqual([...listIn('NEGATIVE_WORDS')].sort(), [...NEGATIVE_WORDS].sort());
});

test('both write paths sanitise before storing, not after reading', () => {
  for (const f of ['api/news.js', 'api/cron-news.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(src, /sanitizeForCompany\(/, f + ' stores unfiltered articles');
    const call = /sanitizeForCompany\([\s\S]{0,80}?\)/.exec(src)[0];
    assert.match(call, /trimArticles/, f + ' must sanitise what it is about to write');
  }
});
