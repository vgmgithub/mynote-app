import { PORTFOLIOS } from './core.js';
import { DB } from './db.js';
import { $, state, el, b, toast, showLoader, setLoader, hideLoader, openModal, closeModal, isPaidPlan, openProInfo, refresh, getInstallId } from './app.js';

// ---------- Feed & Recommendations tab ----------
// Lazy-loaded module: nothing in feed.js is touched (and no network requests
// fire) until the user visits the Feed tab or opens its settings.

let _feedFetchInFlight = false; // simple lock against double-tap on Refresh

function _relTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!t) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  return days + 'd ago';
}

// What the Feed sends, in the same words on both gates: one line, no euphemism. A person deciding
// whether to turn this on should not have to read a policy to find out what leaves the phone.
const FEED_SHARES = 'To find the news, the names of your stocks are shared. Only the names \u2014 never your amounts, prices or anything else you have entered. Everything else in MyNotes stays on your phone.';

// Free Plan: the Feed is the one screen that needs the internet and the only one that sends anything
// off the device, and the news behind it is a paid service. So it is part of the Pro Plan.
function _feedProGate() {
  return el('div', { class: 'chart-card feed-gate' }, [
    el('h3', { text: '⭐ News Feed is a Pro Plan feature' }),
    el('p', { class: 'hint', text: 'See the last 24 hours of news for the stocks you hold, with a simple read on how each one is doing.' }),
    el('p', { class: 'hint', text: 'It needs the internet, and it shares the names of your stocks to find the news. Only the names \u2014 nothing else.' }),
    el('p', { class: 'hint', text: 'Even on the Pro Plan it stays off until you turn it on.' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'What else Pro adds', onclick: () => openProInfo('stocks') }),
    ]),
  ]);
}

// Pro Plan, not yet consented. Paying for the app is not the same as agreeing to have a company name
// sent anywhere, so this is asked of Pro members too, and the answer starts as no.
function _feedConsentGate() {
  return el('div', { class: 'chart-card feed-gate' }, [
    el('h3', { text: 'Turn on the News Feed' }),
    el('p', { class: 'hint', text: 'See the last 24 hours of news for the stocks you hold, with a simple read on each.' }),
    el('p', { class: 'hint', text: FEED_SHARES }),
    el('p', { class: 'hint', text: 'It stays off until you turn it on, and you can turn it off any time.' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Turn on News Feed', onclick: async () => {
        const mod = await import('./feed.js');
        await mod.setFeedConsent(true);
        toast('News Feed is on');
        renderFeed();
      } }),
      el('button', { class: 'btn ghost', text: 'Not now', onclick: () => { state.view = 'holdings'; refresh(); } }),
    ]),
  ]);
}

export async function renderFeed() {
  const host = $('#feedView');
  host.innerHTML = '';
  const mod = await import('./feed.js');
  const portfolio = state.portfolio;

  // Two gates before any news is fetched, in this order.
  //
  // 1. The Feed is a Pro Plan feature. It is the only screen that needs the internet and the only one
  //    that sends anything off the device, and the news it reads costs money to provide.
  if (!isPaidPlan()) { host.appendChild(_feedProGate()); return; }
  // 2. Consent, off until it is switched on, and asked of Pro members too: paying for the app is not
  //    the same as agreeing to have a company name sent anywhere.
  if (!(await mod.getFeedConsent())) { host.appendChild(_feedConsentGate()); return; }

  const cached = await mod.getCachedFeed(portfolio);
  const lastFetched = await mod.getLastFetch(portfolio);
  // Bonds get news-sentiment cards same as any equity, but a coupon
  // instrument has no earnings calls or analyst chatter for that to mean
  // anything - and it already has its own surface (Investment → Bonds) for
  // what actually matters to it (coupon, maturity, vs bank).
  const holdings = state.stocks.filter((s) => s.status !== 'sold' && (s.category || '').toUpperCase() !== 'BONDS');

  host.appendChild(_buildFeedHeader(mod, lastFetched, navigator.onLine ? 'online' : 'offline', portfolio));

  // Whether anything happened in the OTHER portfolios is a question this tab
  // could never answer before - it only ever showed the one that happened to
  // be selected. Cache-only, so it costs no API calls.
  const cross = await _buildCrossPortfolioDigest(mod, portfolio);
  if (cross) host.appendChild(cross);

  if (!holdings.length) {
    host.appendChild(el('div', { class: 'feed-empty', text: 'No active holdings - Feed is empty.' }));
    return;
  }

  // One pass per stock: the call, the sentiment verdict, and whether that call
  // has moved since the last snapshot. Hoisted out of the render loop because
  // all three also drive the ordering and the digest below - and because
  // diffRecommendation writes, so it must run exactly once per stock.
  const todayStr = mod.todayISTDateStr();
  let todayNewsCount = 0;
  const enriched = [];
  for (const stock of holdings) {
    const entry = cached.get(stock.id);
    const hasToday = !!(entry && entry.todayCount > 0);
    const has7d = !!(entry && entry.days && entry.days.length > 0);
    if (hasToday) todayNewsCount++;
    const items = entry ? (entry.items || []) : [];
    const rec = mod.computeRecommendation(
      stock, items, stock.history || [],
      entry ? (entry.sentiment24h || 0) : 0,
      entry ? (entry.sentiment7d || 0) : 0,
      entry ? (entry.days || []) : []
    );
    const diff = await mod.diffRecommendation(portfolio, stock.id, rec, todayStr);
    enriched.push({ stock, entry, hasToday, has7d, rec, verdict: _sentimentVerdict(items), diff });
  }

  // Ordered by what needs attention rather than by name: a critical event
  // three-quarters down an alphabetical list is a critical event nobody
  // reads. Ties break on how loud the week was, then name for stability.
  enriched.sort((a, b) => {
    const ra = FEED_SEVERITY_RANK[a.rec.severity] != null ? FEED_SEVERITY_RANK[a.rec.severity] : 9;
    const rb = FEED_SEVERITY_RANK[b.rec.severity] != null ? FEED_SEVERITY_RANK[b.rec.severity] : 9;
    if (ra !== rb) return ra - rb;
    const sa = Math.abs(a.entry ? (a.entry.sentiment7d || 0) : 0);
    const sb = Math.abs(b.entry ? (b.entry.sentiment7d || 0) : 0);
    if (sa !== sb) return sb - sa;
    return (a.stock.name || '').localeCompare(b.stock.name || '');
  });

  const digest = _buildFeedDigest(enriched);
  if (digest) host.appendChild(digest);

  host.appendChild(el('div', { class: 'feed-section-head' }, [
    el('h3', { class: 'feed-section-title', text: 'Holdings · News & Recommendations' }),
    el('span', { class: 'feed-section-sub', text: 'Sorted by what needs attention · tap a card for the news behind each call' }),
  ]));

  const list = el('div', { class: 'feed-list' });
  for (const row of enriched) {
    const { stock, entry, hasToday, has7d } = row;

    // --- Today's Stocks card ---
    // Built with today's articles only. Stocks with no today news get
    // data-no-today so applyFilter keeps them hidden regardless of tab switch.
    // Computes its own call: today's articles are a narrower signal than the
    // week's, so it is genuinely a different question from the All card's.
    const todayWrapper = el('div', { class: 'feed-item feed-item-today' });
    if (!hasToday) todayWrapper.setAttribute('data-no-today', 'true');
    const todayEntry = entry ? Object.assign({}, entry, { items: entry.todayItems || [] }) : null;
    todayWrapper.appendChild(_buildFeedCard(stock, todayEntry, mod));
    list.appendChild(todayWrapper);

    // --- All tab card ---
    // Full 7-day articles + dot timeline for any stock with news in the window.
    // Reuses the call already computed above rather than recomputing it.
    const allWrapper = el('div', { class: 'feed-item feed-item-all' });
    allWrapper.appendChild(_buildFeedCard(stock, entry, mod, row));
    if (has7d) {
      const tl = _buildFeedTimeline(entry);
      if (tl) allWrapper.appendChild(tl);
    }
    list.appendChild(allWrapper);
  }

  // Switch between Today's Stocks and All. Each stock has two DOM elements -
  // one per context. data-no-today marks stocks that had nothing today so they
  // stay hidden when Today's Stocks is active.
  const applyFilter = (mode) => {
    list.querySelectorAll('.feed-item-today').forEach((w) => {
      w.style.display = (mode === 'today' && !w.getAttribute('data-no-today')) ? '' : 'none';
    });
    list.querySelectorAll('.feed-item-all').forEach((w) => {
      w.style.display = (mode === 'all') ? '' : 'none';
    });
  };
  const btnToday = el('button', { class: 'feed-filter-btn', text: "Today's Stocks (" + todayNewsCount + ')' });
  const btnAll = el('button', { class: 'feed-filter-btn', text: 'All (' + holdings.length + ')' });
  btnToday.onclick = () => { btnToday.classList.add('active'); btnAll.classList.remove('active'); applyFilter('today'); };
  btnAll.onclick = () => { btnAll.classList.add('active'); btnToday.classList.remove('active'); applyFilter('all'); };
  const defaultToday = todayNewsCount > 0;
  (defaultToday ? btnToday : btnAll).classList.add('active');
  host.appendChild(el('div', { class: 'feed-filter' }, [btnToday, btnAll]));
  host.appendChild(list);
  applyFilter(defaultToday ? 'today' : 'all');

  // Auto-fetch if stale. Background; UI shows cached results meanwhile.
  if (navigator.onLine && mod.shouldAutoRefresh(lastFetched, portfolio, Date.now()) && !_feedFetchInFlight) {
    refreshFeedNow(/*silent*/ true);
  }
}

// Ordering for "what needs attention first". Not a quality scale - a
// Critical event and an averaging opportunity are both things to act on,
// they just rank differently in how fast.
const FEED_SEVERITY_RANK = { critical: 0, caution: 1, opportunity: 2, positive: 3, neutral: 4 };
// Direction of travel when a call changes, for the digest only. Deliberately
// coarse: this decides "better or worse", not how much.
const FEED_COLOR_RANK = { red: 0, orange: 1, grey: 2, blue: 3, green: 4 };

// True when today's call differs from the stored one. Checks colour as well as
// label because the same label covers several states ("Hold" is returned for
// no-news, mixed-signals AND a positive week) - those move the colour only.
function _feedCallMoved(diff, rec) {
  if (!diff || !diff.label) return false;
  return diff.label !== rec.label || (diff.color || 'grey') !== (rec.color || 'grey');
}

// One line above the list: what actually moved since the last snapshot, so
// the five-second version doesn't need every card read. Hidden entirely when
// nothing changed - a row saying "0 improved, 0 worsened" is just noise.
function _buildFeedDigest(enriched) {
  let improved = 0, worsened = 0;
  for (const { rec, diff } of enriched) {
    // Colour, not just label: computeRecommendation returns "Hold" for several
    // different states, so a grey Hold (mixed signals) turning into a green
    // Hold (positive week) is a real move that a label-only check can't see.
    if (!_feedCallMoved(diff, rec)) continue;
    const prevRank = FEED_COLOR_RANK[diff.color] != null ? FEED_COLOR_RANK[diff.color] : 2;
    const curRank = FEED_COLOR_RANK[rec.color] != null ? FEED_COLOR_RANK[rec.color] : 2;
    if (curRank > prevRank) improved++;
    else if (curRank < prevRank) worsened++;
  }
  if (!improved && !worsened) return null;
  return el('div', { class: 'feed-digest' }, [
    improved ? el('span', { class: 'feed-digest-up', text: '▲ ' + improved + ' improved' }) : null,
    worsened ? el('span', { class: 'feed-digest-down', text: '▼ ' + worsened + ' worsened' }) : null,
    el('span', { class: 'feed-digest-note', text: 'since the last check' }),
  ].filter(Boolean));
}

// Every portfolio's day at a glance, not just the selected one. Reads only
// what's already cached (no fetch), so it can't spend any of the free tier's
// 100 daily requests - a stale portfolio simply reports what it last knew.
async function _buildCrossPortfolioDigest(mod, currentPortfolio) {
  const rows = await Promise.all(PORTFOLIOS.map(async (p) => {
    const all = await DB.byPortfolio('stocks', p.id).catch(() => []);
    const stocks = (all || []).filter((s) => s.status !== 'sold' && (s.category || '').toUpperCase() !== 'BONDS');
    if (!stocks.length) return { id: p.id, label: p.label, holdings: 0, today: 0, flagged: 0 };
    const cached = await mod.getCachedFeed(p.id).catch(() => new Map());
    let today = 0, flagged = 0;
    for (const s of stocks) {
      const entry = cached.get(s.id);
      if (entry && entry.todayCount > 0) today++;
      const rec = mod.computeRecommendation(
        s, entry ? (entry.items || []) : [], s.history || [],
        entry ? (entry.sentiment24h || 0) : 0,
        entry ? (entry.sentiment7d || 0) : 0,
        entry ? (entry.days || []) : []
      );
      if (rec.severity === 'critical' || rec.severity === 'caution') flagged++;
    }
    return { id: p.id, label: p.label, holdings: stocks.length, today, flagged };
  }));
  if (!rows.some((r) => r.holdings)) return null;
  return el('div', { class: 'feed-cross' }, rows.map((r) => el('div', {
    class: 'feed-cross-item' + (r.id === currentPortfolio ? ' active' : ''),
  }, [
    el('span', { class: 'feed-cross-label', text: r.label }),
    r.holdings
      ? el('span', { class: 'feed-cross-stat' }, [
          el('b', { class: 'fc-today', text: String(r.today) }),
          el('span', { text: ' today · ' }),
          el('b', { class: 'fc-flag' + (r.flagged ? ' on' : ''), text: String(r.flagged) }),
          el('span', { text: ' flagged' }),
        ])
      : el('span', { class: 'feed-cross-stat muted', text: 'no holdings' }),
  ])));
}

function _buildFeedHeader(mod, lastFetched, status, portfolio) {
  // Read the anchor rather than restating it - the schedule lives in feed.js,
  // and a label that disagrees with the actual sync time is worse than none.
  const anchor = mod.feedAnchorFor(portfolio);
  const h12 = ((anchor.h + 11) % 12) + 1;
  const anchorLabel = h12 + ':' + String(anchor.m).padStart(2, '0') + ' ' + (anchor.h < 12 ? 'AM' : 'PM') + ' IST';
  const syncLink = el('span', { class: 'feed-sync-link', text: 'Sync now' });
  syncLink.addEventListener('click', () => refreshFeedNow(false));
  const lastTxt = lastFetched
    ? 'Synced ' + _relTime(new Date(lastFetched).toISOString())
    : 'Not yet synced today';
  const statusDot = status === 'online' ? '●' : status === 'offline' ? '●' : '●';
  return el('div', {}, [
    el('div', { class: 'feed-disclaimer', text:
      'Recommendations use local price history + cached news. Not financial advice. Only stock names leave this device.' }),
    el('div', { class: 'feed-actions' }, [
      el('div', { class: 'feed-schedule' }, [
        el('span', { class: 'feed-anchor', text: 'Auto-syncs daily at ' + anchorLabel }),
        el('span', { class: 'feed-sep', text: '·' }),
        el('span', { class: 'feed-last', text: lastTxt }),
        el('span', { class: 'feed-sep', text: '·' }),
        syncLink,
      ]),
      el('div', { class: 'feed-status ' + status, text: statusDot + ' ' + (status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'No API key') }),
    ]),
  ]);
}

// Classify a single sentiment score. Returns { key, label, icon }.
export function _sentimentFlag(score) {
  if (score > 0.15) return { key: 'pos', label: 'Positive', icon: '📈' };
  if (score < -0.15) return { key: 'neg', label: 'Negative', icon: '📉' };
  return { key: 'neu', label: 'Neutral', icon: '→' };
}

// Count-based verdict over a set of articles. This is what the card face shows,
// so it always agrees with the per-article pills inside: we count how many
// articles are positive / negative / neutral and let the MAJORITY win. A tie
// with content = "Mixed"; nothing notable = "Neutral". Magnitude (the average
// score) is reported separately inside as intensity, not the headline call.
function _sentimentVerdict(items) {
  let pos = 0, neg = 0, neu = 0;
  for (const it of items) {
    const k = _sentimentFlag(Number(it.sentiment) || 0).key;
    if (k === 'pos') pos++; else if (k === 'neg') neg++; else neu++;
  }
  let flag;
  if (pos > neg) flag = { key: 'pos', label: 'Positive', icon: '📈' };
  else if (neg > pos) flag = { key: 'neg', label: 'Negative', icon: '📉' };
  else if (pos > 0) flag = { key: 'mix', label: 'Mixed', icon: '⚖️' };
  else flag = { key: 'neu', label: 'Neutral', icon: '→' };
  return { flag, pos, neg, neu };
}

// Renders the 7-day dot timeline below a feed card.
// Each dot = one day's majority-vote sentiment: pos (green) / neg (red) / neu (gray).
// Returns null if there are no daily buckets yet (nothing to show).
function _buildFeedTimeline(entry) {
  const days = (entry && entry.days) || [];
  if (!days.length) return null;
  const todayCount = (entry && entry.todayCount) || 0;
  const todayTxt = todayCount > 0
    ? todayCount + (todayCount === 1 ? ' article today' : ' articles today')
    : 'No news today';
  return el('div', { class: 'feed-timeline' }, [
    el('div', { class: 'ft-dots' },
      days.map((d) => el('span', { class: 'ft-dot ' + d.sentiment,
        title: d.dateStr + ' · ' + d.count + (d.count === 1 ? ' article' : ' articles') }))
    ),
    el('span', { class: 'ft-today', text: todayTxt }),
  ]);
}

// `pre` carries the call/verdict/diff already computed in renderFeed for the
// All card. Omitted for the Today card, which needs its own - today's
// articles are a narrower window than the week's.
function _buildFeedCard(stock, entry, mod, pre) {
  const items = entry ? (entry.items || []) : [];
  const sentiment24h = entry ? (entry.sentiment24h || 0) : 0;
  const sentiment7d = entry ? (entry.sentiment7d || 0) : 0;
  // Recompute every render - cheap and ensures price-history updates take effect.
  const rec = pre ? pre.rec : mod.computeRecommendation(stock, items, stock.history || [], sentiment24h, sentiment7d, entry ? (entry.days || []) : []);
  const articleCount = items.length;
  const verdict = pre ? pre.verdict : _sentimentVerdict(items);
  const flag = verdict.flag;
  const diff = pre ? pre.diff : null;

  const card = el('div', { class: 'feed-card' });

  // Row 1 - stock name + recommendation badge (the "action" call).
  card.appendChild(el('div', { class: 'feed-card-head' }, [
    el('div', { class: 'feed-stock', text: stock.name }),
    el('div', { class: 'feed-badge ' + (rec.color || 'grey'), text: rec.label }),
  ]));

  // What the call was before it moved. A badge on its own says where you are;
  // this says which way you're travelling, which is the more useful half.
  if (_feedCallMoved(diff, rec)) {
    const prevRank = FEED_COLOR_RANK[diff.color] != null ? FEED_COLOR_RANK[diff.color] : 2;
    const curRank = FEED_COLOR_RANK[rec.color] != null ? FEED_COLOR_RANK[rec.color] : 2;
    const dir = curRank > prevRank ? 'up' : curRank < prevRank ? 'down' : 'flat';
    // Same label, different colour (e.g. a mixed-signals Hold turning into a
    // positive-week Hold): "was Hold" would read as no change at all, so say
    // which way it moved instead of naming a label that hasn't changed.
    const note = diff.label !== rec.label
      ? 'was “' + diff.label + '”'
      : (dir === 'up' ? 'improved since the last check' : dir === 'down' ? 'weakened since the last check' : 'shifted since the last check');
    card.appendChild(el('div', { class: 'feed-changed ' + dir }, [
      el('span', { class: 'fc-arrow', text: dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→' }),
      el('span', { text: note }),
    ]));
  }

  // Row 2 - sentiment verdict pill + transparent count breakdown.
  // The breakdown explains the verdict so it never contradicts the articles.
  const flagRow = el('div', { class: 'feed-flag-row' });
  if (articleCount) {
    flagRow.appendChild(el('span', { class: 'feed-flag ' + flag.key, text: flag.icon + ' ' + flag.label }));
    const breakdown = el('span', { class: 'feed-breakdown' });
    if (verdict.pos) breakdown.appendChild(el('span', { class: 'fb pos', text: verdict.pos + '▲' }));
    if (verdict.neg) breakdown.appendChild(el('span', { class: 'fb neg', text: verdict.neg + '▼' }));
    if (verdict.neu) breakdown.appendChild(el('span', { class: 'fb neu', text: verdict.neu + '·' }));
    flagRow.appendChild(breakdown);
  } else {
    flagRow.appendChild(el('span', { class: 'feed-flag neu muted', text: '· No news' }));
  }
  card.appendChild(flagRow);

  // Row 3 - recommendation reason.
  card.appendChild(el('div', { class: 'feed-reason', text: rec.reason }));

  if (articleCount) {
    const expandHint = el('div', { class: 'feed-expand-hint', text: 'Tap for news & sentiment ▾' });
    card.appendChild(expandHint);

    // Expanded panel - hidden until tap. Holds the detailed numbers + articles.
    const panel = el('div', { class: 'feed-articles hidden' });

    // Verdict recap + average-score intensity (clearly labelled so the average
    // is never mistaken for the headline call).
    const s24 = (sentiment24h >= 0 ? '+' : '') + sentiment24h.toFixed(2);
    const s7 = (sentiment7d >= 0 ? '+' : '') + sentiment7d.toFixed(2);
    panel.appendChild(el('div', { class: 'feed-sent-detail' }, [
      el('div', { class: 'feed-sent-item' }, [
        el('span', { class: 'feed-sent-k', text: 'Verdict' }),
        el('span', { class: 'feed-sent-v ' + flag.key, text: flag.label }),
        el('span', { class: 'feed-sent-x', text: verdict.pos + ' pos · ' + verdict.neg + ' neg · ' + verdict.neu + ' neutral' }),
      ]),
      el('div', { class: 'feed-sent-item' }, [
        el('span', { class: 'feed-sent-k', text: 'Avg score · 24h / 7d' }),
        el('span', { class: 'feed-sent-v ' + _sentimentFlag(sentiment7d).key, text: s24 + ' / ' + s7 }),
        el('span', { class: 'feed-sent-x', text: 'intensity, −1 to +1' }),
      ]),
    ]));

    for (const it of items) {
      const link = el('a', { href: it.url || '#', target: '_blank', rel: 'noopener', text: it.title || '(no title)' });
      const af = _sentimentFlag(Number(it.sentiment) || 0);
      panel.appendChild(el('div', { class: 'feed-article' }, [
        el('div', { class: 'feed-article-title' }, [link]),
        it.summary ? el('div', { class: 'feed-article-summary', text: it.summary }) : null,
        el('div', { class: 'feed-article-meta' }, [
          el('span', { class: 'feed-article-source', text: it.source || 'Source' }),
          el('span', { text: _relTime(it.publishedAt) }),
          el('span', { class: 'feed-article-sentiment ' + af.key, text: af.label }),
        ]),
      ].filter(Boolean)));
    }
    card.appendChild(panel);

    // Toggle on card tap (but not on link tap - links handle their own clicks).
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      panel.classList.toggle('hidden');
      expandHint.textContent = panel.classList.contains('hidden') ? 'Tap for news & sentiment ▾' : 'Tap to hide ▴';
    });
  }
  return card;
}

// `forPortfolios` names the group to sync. Left out, it is the group the visible portfolio belongs to,
// which is what the Sync now link and the stale-cache trigger on the tab want.
async function refreshFeedNow(silent, forPortfolios) {
  if (_feedFetchInFlight) return;
  _feedFetchInFlight = true;
  try {
    const mod = await import('./feed.js');
    // The same two gates as the tab itself. refreshFeedNow is also reached from the auto-refresh on
    // startup, so both have to be checked here as well or news could be fetched without consent.
    if (!isPaidPlan()) { if (!silent) toast('News Feed is part of the Pro Plan'); return; }
    if (!(await mod.getFeedConsent())) { if (!silent) toast('Turn on the News Feed first'); return; }
    const installId = await getInstallId();
    if (!installId) { if (!silent) toast('This device is not set up for news yet'); return; }
    if (!navigator.onLine) {
      if (!silent) toast('You\'re offline - showing cached news');
      return;
    }
    // India portfolios (me-in, wife-in) are synced together so a stock that
    // appears in both only gets one API request - the news is saved to both.
    // US is single-portfolio only (different market, no overlap expected).
    const portfolios = forPortfolios && forPortfolios.length ? forPortfolios : mod.feedGroupFor(state.portfolio);

    // Load active holdings for each portfolio in scope. Bonds are skipped here
    // for the same reason renderFeed hides them - no point spending one of the
    // 100 daily requests on something the Feed will never show.
    const portfolioStocks = new Map();
    for (const p of portfolios) {
      const all = p === state.portfolio
        ? state.stocks
        : await DB.byPortfolio('stocks', p).catch(() => []);
      portfolioStocks.set(p, (all || []).filter((s) => s.status !== 'sold' && (s.category || '').toUpperCase() !== 'BONDS'));
    }

    // One request per COMPANY, not per holding: the news for a stock is the
    // same news whoever owns it, so a name held in both portfolios is fetched
    // once and written to both. Keyed on feed.js's own company normalisation
    // (strips Ltd/Limited/Corp, punctuation, case) rather than a plain
    // lowercase - the same company is rarely typed identically in two
    // portfolios, and "Infosys" vs "Infosys Ltd" would otherwise cost two
    // requests to fetch one company's news twice.
    const byName = new Map(); // normName → { fetchName, targets[] }
    for (const [p, stocks] of portfolioStocks) {
      for (const s of stocks) {
        const norm = mod.normCompanyName(s.name) || s.name.trim().toLowerCase();
        if (!byName.has(norm)) byName.set(norm, { fetchName: s.name, targets: [] });
        byName.get(norm).targets.push({ stockId: s.id, portfolio: p, stockName: s.name });
      }
    }

    const totalUnique = byName.size;
    if (!totalUnique) {
      // Nothing held in this group. Stamp the day anyway so an empty portfolio is not re-checked on
      // every single app open.
      for (const p of portfolios) await mod.setLastFetch(p, Date.now());
      if (!silent) toast('No holdings to fetch');
      return;
    }
    if (!silent) showLoader('Fetching news… 0/' + totalUnique);

    // Privacy: only stock NAME leaves the device (one request per unique name).
    const toFetch = [...byName.entries()].map(([norm, d]) => ({ id: norm, name: d.fetchName }));
    // Ask from the day after the last one already saved, so a device that has been shut for a few days
    // collects the days it missed rather than only today's.
    const since = await mod.oldestMissingDay(portfolios);
    const result = await mod.fetchNewsForStocks(toFetch, installId, (p) => {
      if (!silent) setLoader('Fetching news… ' + p.done + '/' + p.total + (p.current ? ' · ' + p.current : ''));
    }, null, since);

    const now = Date.now();
    const todayIST = new Date(now + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
    let stocksWithNews = 0, errors = 0;

    let limited = 0;
    for (const [norm, d] of byName) {
      const r = result.get(norm) || { days: [], error: null };
      if (r.error) { errors++; continue; } // preserve existing cache on error
      if (r.limited) limited++;
      const today = (r.days || []).find((x) => x.day === todayIST);
      if (today && today.items.length) stocksWithNews++;
      // One bucket per day the server sent back - today's, plus any day this device missed while it
      // was shut. Save to every portfolio that holds this stock (may be more than one).
      for (const day of r.days || []) {
        for (const target of d.targets) {
          await mod.saveFeedEntry({
            portfolio: target.portfolio,
            stockId: target.stockId,
            stockName: target.stockName,
            items: day.items || [],
            lastError: null,
          }, day.day);
        }
      }
    }

    // Stamp lastFetch for every portfolio synced - so switching to wife-in
    // doesn't trigger a duplicate sync if me-in already ran this morning.
    const totalFailure = errors === byName.size;
    if (!totalFailure) {
      for (const p of portfolios) await mod.setLastFetch(p, now);
    }
    if (!silent) hideLoader();
    if (!silent) {
      if (totalFailure) {
        toast('News service unavailable (rate limit or network). Showing cached.');
      } else {
        const saved = byName.size - errors;
        // "Today's news is not in yet" rather than an error: the Feed is showing everything collected
        // so far, and today's will arrive on the next refresh or tomorrow.
        const summary = limited === byName.size && byName.size
          ? 'Showing saved news · today’s is not in yet, try again later'
          : 'Feed updated · ' + stocksWithNews + ' with news, ' + (saved - stocksWithNews) + ' quiet' + (errors ? ' · ' + errors + ' skipped' : '');
        toast(summary);
      }
    }
    // Re-render only if still on Feed tab.
    if (state.view === 'feed') renderFeed();
  } catch (e) {
    if (!silent) { hideLoader(); toast('Refresh failed: ' + (e.message || e)); }
    else console.warn('feed auto-refresh failed', e);
  } finally {
    _feedFetchInFlight = false;
  }
}

// Called once on app open. Silently refreshes the feed for the current
// portfolio if data is stale - so the user gets fresh news just by opening
// the app, without needing to visit the Feed tab first.
export async function _autoRefreshFeedOnInit() {
  if (!navigator.onLine) return;
  try {
    if (!isPaidPlan()) return;                        // Pro Plan feature
    const mod = await import('./feed.js');
    if (!(await mod.getFeedConsent())) return;        // not switched on: nothing may be sent
    // Every market that is due, not just the one on screen. Sequential: refreshFeedNow holds a lock
    // while it runs, so firing both at once would silently drop the second.
    const last = new Map();
    for (const group of mod.FEED_GROUPS) for (const p of group) last.set(p, await mod.getLastFetch(p));
    for (const group of mod.dueGroups((p) => last.get(p), Date.now())) {
      await refreshFeedNow(/*silent*/ true, group);
    }
  } catch (_) { /* feed.js not available or DB error - silently skip */ }
}

// Switching the Feed back off, from the Feed tab itself. There is nothing else left to set: the news
// key lives on the server, so the only thing a person can decide here is whether to take part at all.
export async function openFeedSettings() {
  const mod = await import('./feed.js');
  const on = await mod.getFeedConsent();
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'News Feed' }),
    el('p', { class: 'hint', text: FEED_SHARES }),
    el('p', { class: 'hint', text: on
      ? 'The Feed is on. Turn it off and nothing more is shared; the news already on your phone stays.'
      : 'The Feed is off, so nothing is being shared.' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ' + (on ? 'danger' : 'primary'), text: on ? 'Turn off News Feed' : 'Turn on News Feed', onclick: async () => {
        await mod.setFeedConsent(!on);
        closeModal();
        toast(on ? 'News Feed turned off' : 'News Feed is on');
        if (state.view === 'feed') renderFeed();
      }}),
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}
