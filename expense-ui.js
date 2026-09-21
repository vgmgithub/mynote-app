import { thisYm, todayISO, num } from './core.js';
import { fmtIntCur, renderPersonal, tagsOf, isForOthers, TAG_MAX, updateExpNavActive, spendEntryFilter, spendFilterNote, tagRow, tagField, knownTags, catAddBtn, openCatManager, normaliseTag } from './personal-ui.js';
import { ui } from './state.js';
import { DB } from './db.js';
import { renderCc } from './cc-ui.js';
import { efLoad } from './ef.js';
import { _vaultCopyBtn } from './vault-ui.js';
import { el, b, modOn, _modsCache, state, $, toast, closeModal, openModal, EXPENSE_START_YM, expRenderStale, appConfirm, _historyIcon, _spendableDaysLeft, perDayLabel, perDayAllowance, TRACKER_START_YM, field, _fetchLiveRates, isSgb } from './app.js';

// ---------- Tags tab: what the handles add up to ----------
//
// A tag is only worth writing if it can be read back, and this is the reading:
// every tag in use, what it has cost, how often it recurs, and how that has
// moved month on month - across BOTH trackers, household and personal, since a
// habit does not care which pocket paid for it.
//
// Two things are stated rather than left for the user to trip over:
//
//   * COVERAGE. An analysis of the third of spending that happens to carry a
//     tag, presented as an analysis of spending, is a lie by omission. The
//     untagged remainder is named first, before any single tag is.
//   * OVERLAP. An entry carries up to six tags, so the tag totals add up to
//     MORE than the tagged spend. A column of figures that does not sum to its
//     own total, with nothing saying why, reads as a bug.
//
// Months here are the months the money was SPENT in, for both stores. The card
// tabs count a card spend on the bill it lands on, which is right for a bill -
// but a tag is about when a habit happened, and two stores counting months by
// different rules would put incomparable bars side by side.
const TAG_RANGES = [[1, 'This month'], [3, '3m'], [6, '6m'], [12, '12m'], [0, 'All']];
const TAG_SOURCES = [['all', 'Both'], ['house', 'Household'], ['personal', 'Personal']];
const _tagOpen = {};
// Which tags are being looked FOR, as opposed to read about. Empty means the
// tab is in its usual analysing mode.
// Four ways to read the same list, because "which costs most" and "which have
// I stopped using" are different questions and only one of them is answered by
// a total.
const TAG_SORTS = [['total', 'Spend'], ['count', 'Entries'], ['recent', 'Recent'], ['az', 'A-Z']];
const _tagCatOpen = {};     // which categories are open in a find result

// Twelve months of a tag in eighteen pixels, so the shape of it is on the
// closed row. Reading whether something is growing used to cost a tap and a
// full bar chart, which meant it was never read while scanning.
//
// Heights are absolute against the tag's own peak, not against its neighbours':
// this answers "is this one going up", and a shared scale would flatten every
// small tag into a straight line and say nothing about any of them.
function _tagSpark(yms, byYm, thisYm) {
  const peak = yms.reduce((m, y) => Math.max(m, Math.abs(byYm.get(y) || 0)), 1);
  return el('span', { class: 'tag-spark' }, yms.map((y) => {
    const v = Math.abs(byYm.get(y) || 0);
    return el('span', {
      class: 'tag-spark-bar' + (v > 0 ? '' : ' is-zero') + (y === thisYm ? ' is-now' : ''),
      style: 'height:' + Math.max(7, (v / peak) * 100).toFixed(1) + '%',
      title: _spendMonthLabel(y) + ' · ' + (v > 0 ? fmtIntCur(v) : 'nothing'),
    });
  }));
}

// One logged spend, as it appears under a tag. Shared by the per-tag list and
// by the find results, so the two never drift into showing different things
// about the same entry.
function _tagEntryRow(x, cardName, withTags, labelAs) {
  const meta = [_spendDayLabel(x.r.date), x.r.method || 'UPI'];
  if (x.r.cardId != null && cardName.has(x.r.cardId)) meta.push(cardName.get(x.r.cardId));
  // Inside a category, naming the category on every row says nothing - you
  // opened it. The dot is already colouring household against personal, so
  // the word that earns the space there is the one the dot stands for.
  const lead = labelAs === 'source'
    ? (x.src === 'house' ? 'Household' : 'Personal')
    : (x.r.category || 'Misc');
  const label = el('div', { class: 'msheet-label' }, [
    el('span', {}, [
      el('i', { class: 'rvw-dot ' + (x.src === 'house' ? 'is-house' : 'is-personal') }),
      lead,
    ]),
    el('span', { class: 'msheet-note', text: meta.join(' · ') }),
  ]);
  // On a find, every entry says which of its tags it came back for - with two
  // tags matched on "any", the row is otherwise silent about why it is there.
  if (withTags && x.tags.length) {
    label.appendChild(el('span', { class: 'tag-row tag-find-tags' },
      x.tags.map((t) => el('span', { class: 'tag-pill' + (ui._tagPicked.has(t) ? ' is-hit' : ''), text: t }))));
  }
  return el('div', { class: 'msheet-row trk-entry' }, [
    label,
    el('span', { class: 'msheet-val', text: fmtSheetCur(x.amount) }),
  ]);
}

// One row per tag per entry it is on, rolled up. Kept separate from the
// rendering so the arithmetic can be read in one piece.
function _tagRollup(entries) {
  const byTag = new Map();
  entries.forEach((x) => x.tags.forEach((t) => {
    let e = byTag.get(t);
    if (!e) e = { tag: t, total: 0, count: 0, house: 0, personal: 0, yms: new Map(), with: new Map(), rows: [] };
    e.total = round2(e.total + x.amount);
    e.count += 1;
    e[x.src] = round2(e[x.src] + x.amount);
    e.yms.set(x.ym, round2((e.yms.get(x.ym) || 0) + x.amount));
    e.rows.push(x);
    // Which tags travel together. Counted per entry, so "weekly" and "eat out"
    // on the same spend is one pairing, not two.
    x.tags.forEach((o) => { if (o !== t) e.with.set(o, (e.with.get(o) || 0) + 1); });
    byTag.set(t, e);
  }));
  byTag.forEach((e) => {
    e.avg = round2(e.total / Math.max(1, e.count));
    e.months = e.yms.size;
    // Median, not mean: one heavy month should not become "what this usually
    // costs" - the same rule the Review tab is built on.
    e.usual = _median([...e.yms.values()]);
    e.lastYm = [...e.yms.keys()].sort().pop() || null;
  });
  return [...byTag.values()].sort((a, b) => b.total - a.total || b.count - a.count || a.tag.localeCompare(b.tag));
}

// Household or personal is a CHOICE here, not a property of where the tab
// lives. The same handle turns up on both sides of the books - "weekly" on the
// grocery run and on the Friday coffee - and the useful question is usually
// both at once, with either side available on its own.
//
// `o.rerender` / `o.stale` are the owning section's, so a chip press repaints
// the right view and a slow load that has been navigated away from is dropped.
export async function renderTagAnalysis(host, token, o) {
  o = o || {};
  const rerender = o.rerender || renderPersonal;
  const stale = o.stale || pfRenderStale;
  const mod = await import('./credit.js');
  const [houseRows, pfRows, cards] = await Promise.all([
    DB.all('spends').catch(() => []),
    DB.all('personalSpends').catch(() => []),
    DB.all('creditCards').catch(() => []),
  ]);
  if (stale(token)) return;
  const cardName = new Map((cards || []).map((c) => [c.id, c.name || 'Card']));

  const shape = (rows, src) => (rows || []).map((r) => ({
    r, src,
    ym: String(r.date || r.ym || '').slice(0, 7),
    amount: round2(Number(r.amount) || 0),
    tags: tagsOf(r),
    // `!== 0` rather than `> 0`: a refund is a real, tagged movement, and it
    // belongs against the tag it is giving money back to.
  })).filter((x) => /^\d{4}-\d{2}$/.test(x.ym) && x.amount !== 0);

  // Spends made for somebody else are LEFT OUT of every figure on this page.
  //
  // This whole tab is about habits - what a handle costs, whether it is
  // growing, what it usually runs to in a month. Money fronted for somebody
  // who is paying it back is not a habit; it passed through. It is already
  // kept out of the two limits and out of Review for exactly that reason, and
  // a tab that counted it would have "eat out" jump every time a dinner got
  // paid for and settled up afterwards.
  //
  // Left out, not hidden: the count and the total are said on the coverage
  // card below, because a figure that silently disagrees with the entries list
  // is worse than a bigger one.
  const allRaw = shape(houseRows, 'house').concat(shape(pfRows, 'personal'));
  const all = allRaw.filter((x) => !isForOthers(x.r));

  // ---- Scope: how far back, and whose spending ----
  const thisYm = todayISO().slice(0, 7);
  let fromYm = null;
  if (ui._tagRange > 0) {
    const d = new Date(Number(thisYm.slice(0, 4)), Number(thisYm.slice(5, 7)) - ui._tagRange, 1);
    fromYm = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  // Only the spending sides the user chose exist here: both -> Both/Household/
  // Personal chips; just one -> no chips, and only that side's data.
  const _hasHouse = modOn(_modsCache, 'expense');
  const _hasPersonal = modOn(_modsCache, 'personal');
  const _tagSources = _hasHouse && _hasPersonal ? TAG_SOURCES
    : _hasPersonal ? TAG_SOURCES.filter(([v]) => v === 'personal')
    : TAG_SOURCES.filter(([v]) => v === 'house');
  const source = _tagSources.length === 1 ? _tagSources[0][0] : ui._tagSource;
  const withinScope = (x) => (fromYm ? x.ym >= fromYm : true) && (source === 'all' || x.src === source);
  const scoped = all.filter(withinScope);
  const forOthers = allRaw.filter((x) => isForOthers(x.r) && withinScope(x));
  const forOthersTotal = round2(forOthers.reduce((a, x) => a + Math.max(0, x.amount), 0));

  const chipRow = (opts, cur, pick) => el('div', { class: 'pf-filter' }, opts.map(([v, label]) => el('button', {
    type: 'button', class: 'pf-filter-chip' + (String(v) === String(cur) ? ' active' : ''), text: label,
    onclick: () => { if (String(v) === String(cur)) return; pick(v); rerender(); },
  })));
  host.appendChild(el('div', { class: 'tag-an-scope' }, [
    chipRow(TAG_RANGES, ui._tagRange, (v) => { ui._tagRange = v; }),
    // One side only -> nothing to choose between, so no source chips at all.
    _tagSources.length > 1 ? chipRow(_tagSources, source, (v) => { ui._tagSource = v; }) : null,
  ].filter(Boolean)));

  if (!all.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\ud83c\udff7\ufe0f' }),
      el('p', { text: 'Nothing logged yet.' }),
      el('p', { class: 'hint', text: 'Tag a spend here or on the household Tracker and it turns up here.' }),
    ]));
    return;
  }

  // ---- Coverage, first: how much of this scope the tags actually speak for ----
  const sum = (xs) => round2(xs.reduce((a, x) => a + x.amount, 0));
  // Coverage is a share, so it is measured on money that WENT OUT - gross,
  // refunds left out of both halves. Netting them in made the untagged
  // remainder go negative and the coverage read 105%, which is not a share of
  // anything. The refunds are named on their own line instead, and they still
  // net off inside the tag they belong to, which is where they mean something.
  const gross = (xs) => round2(xs.reduce((a, x) => a + Math.max(0, x.amount), 0));
  const total = gross(scoped);
  const tagged = scoped.filter((x) => x.tags.length);
  const taggedTotal = gross(tagged);
  const untagged = round2(total - taggedTotal);
  const pct = total > 0 ? (taggedTotal / total) * 100 : 0;
  const backTotal = round2(Math.abs(sum(scoped.filter((x) => x.amount < 0))));
  const backTagged = round2(Math.abs(sum(tagged.filter((x) => x.amount < 0))));
  const rangeLabel = ui._tagRange === 1 ? 'this month'
    : (ui._tagRange > 0 ? 'last ' + ui._tagRange + ' months' : 'all time');
  const srcLabel = (TAG_SOURCES.find(([v]) => v === source) || [null, 'Both'])[1].toLowerCase();

  const tags = _tagRollup(tagged);

  // ---- Finding spends, as opposed to reading about tags ----
  //
  // Two different jobs on one tab. The list below answers "what is my eat-out
  // habit costing"; this answers "show me the eat-out spends". The list could
  // only ever do the second one tag at a time, forty rows at a time, through
  // an accordion - and never for two tags at once, which is exactly the
  // question worth asking of tags that travel together.
  //
  // Picks that fall outside the current scope are dropped rather than kept
  // invisibly: a chip you cannot see is not a filter you can turn off.
  const inScope = new Set(tags.map((t) => t.tag));
  ui._tagPicked = new Set([...ui._tagPicked].filter((t) => inScope.has(t)));

  const modeBtn = (label, on, fn) => el('button', {
    type: 'button', class: on ? 'active' : '', text: label,
    onclick: () => { if (on) return; fn(); rerender(); },
  });

  if (tags.length) {
    // A cloud, not a row of identical pills. Every chip was the same size and
    // said the same thing, so the picture of a month's tagging - one habit
    // dwarfing four others, or five running level - was nowhere on the page
    // until you read every total in the list below.
    //
    // Size and tint both track the tag's share of tagged spend, so weight is
    // legible at a glance and again on a second look. Tint uses color-mix with
    // a plain background declared first, so a browser without it gets flat
    // chips rather than invisible ones.
    const heaviest = tags.reduce((m, t) => Math.max(m, Math.abs(t.total)), 1);
    const cloud = el('div', { class: 'tag-cloud' });
    const note = el('p', { class: 'tag-find-note' });

    // The cloud is capped at two and a half rows on purpose: the half row
    // showing at the bottom is what says there is more to scroll to. A full
    // row would look like the end of the list.
    //
    // Searching redraws ONLY the cloud, never the whole tab. Re-rendering on
    // every keystroke would take the focus out of the box being typed in,
    // which is the classic way to make a search field unusable on a phone.
    const drawCloud = () => {
      const q = ui._tagSearch.trim().toLowerCase();
      const shown = q ? tags.filter((t) => t.tag.toLowerCase().indexOf(q) >= 0) : tags;
      cloud.innerHTML = '';
      shown.forEach((t) => {
        const w = Math.abs(t.total) / heaviest;                  // 0..1
        cloud.appendChild(el('button', {
          type: 'button',
          class: 'tag-cloud-chip' + (ui._tagPicked.has(t.tag) ? ' active' : ''),
          style: '--w:' + (w * 100).toFixed(1) + ';--fs:' + (0.72 + w * 0.34).toFixed(3) + 'rem',
          title: t.tag + ' · ' + fmtSheetCur(t.total) + ' across ' + t.count
            + (t.count === 1 ? ' entry' : ' entries'),
          onclick: () => {
            if (ui._tagPicked.has(t.tag)) ui._tagPicked.delete(t.tag); else ui._tagPicked.add(t.tag);
            rerender();
          },
        }, [
          el('span', { class: 'tag-cloud-name', text: t.tag }),
          el('span', { class: 'tag-cloud-amt', text: fmtIntCur(Math.abs(t.total)) }),
        ]));
      });
      if (!shown.length) {
        cloud.appendChild(el('p', { class: 'hint', style: 'margin:6px 2px',
          text: 'No tag matches “' + ui._tagSearch.trim() + '”.' }));
      }
      // A tag picked and then searched past is still filtering the results
      // below. Saying so is the difference between a stale-looking page and
      // an explained one.
      const hiddenPicks = q ? [...ui._tagPicked].filter((t) => t.toLowerCase().indexOf(q) < 0).length : 0;
      note.textContent = ui._tagPicked.size
        ? ui._tagPicked.size + ' of ' + tags.length + ' picked'
          + (hiddenPicks ? ' · ' + hiddenPicks + ' hidden by the search' : '')
        : (q ? shown.length + ' of ' + tags.length + ' tags' : '');
      note.classList.toggle('hidden', !note.textContent);
    };

    // Only worth a search box once the cloud is long enough to hunt through.
    const searchInp = el('input', {
      type: 'search', class: 'tag-search', placeholder: 'Search tags',
      value: ui._tagSearch, autocomplete: 'off',
    });
    searchInp.addEventListener('input', () => { ui._tagSearch = searchInp.value; drawCloud(); });
    const wantSearch = tags.length > 6;
    if (!wantSearch) ui._tagSearch = '';

    drawCloud();
    host.appendChild(el('div', { class: 'tag-find' }, [
      el('div', { class: 'tag-find-head' }, [
        wantSearch ? searchInp
          : el('span', { class: 'tag-find-label', text: ui._tagPicked.size
            ? ui._tagPicked.size + ' of ' + tags.length + ' picked' : 'Tap a tag to find its spends' }),
        // Only when the choice exists. With one tag picked, any and all are
        // the same thing, and a toggle that changes nothing is a puzzle.
        ui._tagPicked.size >= 2 ? el('div', { class: 'tag-find-mode' }, [
          modeBtn('Any', !ui._tagMatchAll, () => { ui._tagMatchAll = false; }),
          modeBtn('All', ui._tagMatchAll, () => { ui._tagMatchAll = true; }),
        ]) : document.createTextNode(''),
        ui._tagPicked.size ? el('button', { class: 'tag-find-clear', type: 'button', text: 'Clear',
          onclick: () => { ui._tagPicked = new Set(); rerender(); } }) : document.createTextNode(''),
      ]),
      cloud,
      note,
    ]));
  }

  if (ui._tagPicked.size) {
    const picked = [...ui._tagPicked];
    const hits = tagged.filter((x) => (ui._tagMatchAll
      ? picked.every((t) => x.tags.indexOf(t) >= 0)
      : picked.some((t) => x.tags.indexOf(t) >= 0)));
    const joiner = ui._tagMatchAll ? ' + ' : ' or ';

    if (!hits.length) {
      host.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:18px 0',
        text: ui._tagMatchAll
          ? 'Nothing carries all of those tags at once in ' + rangeLabel + '. Try Any.'
          : 'Nothing under those tags in ' + rangeLabel + '.' }));
      return;
    }

    const net = round2(hits.reduce((a, x) => a + x.amount, 0));
    const out = round2(hits.reduce((a, x) => a + Math.max(0, x.amount), 0));
    const back = round2(out - net);
    const yms = [...new Set(hits.map((x) => x.ym))].sort();

    const fig = (n, label) => el('div', { class: 'tag-find-fig' }, [
      el('div', { class: 'tag-find-fig-n', text: n }),
      el('div', { class: 'tag-find-fig-l', text: label }),
    ]);
    host.appendChild(el('div', { class: 'chart-card tag-find-sum' }, [
      el('h3', { text: picked.join(joiner) }),
      el('p', { class: 'hint', style: 'margin:0 0 12px', text: rangeLabel + ' · '
        + (source === 'all' ? 'household and personal' : srcLabel + ' only') + ' · '
        + (ui._tagMatchAll ? 'entries carrying every one of these' : 'entries carrying any of these') }),
      el('div', { class: 'tag-find-figs' }, [
        fig(fmtSheetCur(net), hits.length + (hits.length === 1 ? ' spend' : ' spends')),
        fig(fmtIntCur(round2(out / hits.length)), 'each, on average'),
        yms.length > 1 ? fig(fmtIntCur(round2(out / yms.length)), 'a month across ' + yms.length)
          : fig(String(yms.length ? 1 : 0), 'month'),
      ]),
      back > 0 ? el('p', { class: 'hint pf-refund-line', style: 'margin:10px 0 0',
        text: fmtSheetCur(back) + ' of that came back · ' + fmtSheetCur(out) + ' went out' })
        : document.createTextNode(''),
    ]));

    // Where it went, in the shape the rest of the page already uses: one
    // collapsed row per category, opening onto its own spends. It was two
    // cards before - a bar chart of categories, then a flat list of every
    // entry underneath - which meant seeing the four spends behind "Food"
    // required reading the whole list and picking them out by eye. A tag list
    // and a category list answer the same kind of question, so they are the
    // same control, and one thing to learn covers both.
    const byCat = new Map();
    hits.forEach((x) => {
      const k = x.r.category || 'Misc';
      const e = byCat.get(k) || { cat: k, total: 0, count: 0, yms: new Set(), rows: [] };
      e.total = round2(e.total + x.amount);
      e.count += 1;
      e.yms.add(x.ym);
      e.rows.push(x);
      byCat.set(k, e);
    });
    const cats = [...byCat.values()].sort((a, b) => b.total - a.total || b.count - a.count);
    const topCat = cats.reduce((m, c) => Math.max(m, Math.abs(c.total)), 1);
    const grossHits = round2(hits.reduce((a, x) => a + Math.max(0, x.amount), 0)) || 1;

    const catList = el('div', { class: 'tag-an-list' });
    cats.forEach((c) => {
      const gross = round2(c.rows.reduce((a, x) => a + Math.max(0, x.amount), 0));
      const share = (gross / grossHits) * 100;
      const open = !!_tagCatOpen[c.cat];
      const body = el('div', { class: 'tag-an-body' + (open ? '' : ' hidden') });
      const head = el('button', { class: 'tag-an-head' + (open ? ' is-open' : ''), type: 'button' }, [
        el('div', { class: 'tag-an-top' + (c.total < 0 ? ' is-refund' : '') }, [
          el('span', { class: 'tag-pill', text: c.cat }),
          el('span', { class: 'tag-an-total', text: fmtSigned(c.total) }),
        ]),
        el('span', { class: 'tag-an-track' }, [
          el('span', { class: 'tag-an-fill', style: 'width:'
            + Math.max(1.5, (Math.abs(c.total) / topCat) * 100).toFixed(1) + '%' }),
        ]),
        // A category holding nothing but a refund has no share and no average -
        // it is money coming back, and "0% of these · 1 spend · 0 each" is three
        // ways of saying nothing. It gets the same wording the tag list uses.
        el('span', { class: 'tag-an-meta', text: (gross > 0
          ? share.toFixed(0) + '% of these · ' + c.count + (c.count === 1 ? ' spend' : ' spends')
            + ' · ' + fmtIntCur(round2(gross / c.count)) + ' each'
          : 'came back · ' + c.count + (c.count === 1 ? ' entry' : ' entries'))
          + ' · ' + c.yms.size + (c.yms.size === 1 ? ' month' : ' months') }),
        el('span', { class: 'rvw-sec-chev tag-an-chev' }),
      ]);
      head.addEventListener('click', () => {
        const closed = body.classList.toggle('hidden');
        _tagCatOpen[c.cat] = !closed;
        head.classList.toggle('is-open', !closed);
      });

      const rows = c.rows.slice().sort((a, b) => String(b.r.date || '').localeCompare(String(a.r.date || '')));
      const entries = el('div', { class: 'msheet tag-an-entries' });
      rows.slice(0, 60).forEach((x) => entries.appendChild(_tagEntryRow(x, cardName, true, 'source')));
      if (rows.length > 60) {
        entries.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:10px 0;margin:0',
          text: '+' + (rows.length - 60) + ' older entries not listed · narrow the range above' }));
      }
      body.appendChild(entries);
      catList.appendChild(el('section', { class: 'tag-an-sec' }, [head, body]));
    });
    host.appendChild(catList);
    return;
  }

  host.appendChild(el('div', { class: 'chart-card tag-cover' }, [
    el('h3', { text: 'Tagged spending' }),
    el('p', { class: 'hint', style: 'margin:0 0 10px',
      text: rangeLabel + ' · ' + (source === 'all' ? 'household and personal' : srcLabel + ' only')
        + ' · ' + (ui._tagRange === 1 ? 'by the date spent' : 'months counted by the date spent') }),
    el('div', { class: 'tag-cover-bar' }, [
      el('span', { class: 'tag-cover-fill', style: 'width:' + pct.toFixed(1) + '%' }),
    ]),
    el('div', { class: 'tag-cover-legend' }, [
      el('span', {}, [el('i', { class: 'rvw-dot is-spent' }), 'tagged ' + fmtSheetCur(taggedTotal)]),
      el('span', {}, [el('i', { class: 'rvw-dot is-flat' }), 'untagged ' + fmtSheetCur(untagged)]),
      el('b', { text: pct.toFixed(0) + '% covered' }),
    ]),
    el('p', { class: 'hint', style: 'margin:10px 0 0', text: tags.length
      ? tags.length + (tags.length === 1 ? ' tag' : ' tags') + ' on ' + tagged.length
        + (tagged.length === 1 ? ' entry' : ' entries') + ', out of ' + scoped.length + ' logged. '
        + (pct >= 99.5 ? 'Everything logged in this scope carries a tag, so the figures below cover all ' + fmtSheetCur(total) + ' of it.'
          : pct < 60 ? 'Under ' + Math.round(pct) + '% of this spending carries a tag, so read the figures below as being about that share of it, not all of it.'
          : 'Everything below is about that ' + Math.round(pct) + '%, not the whole ' + fmtSheetCur(total) + '.')
      : 'Nothing in this scope carries a tag yet.' }),
    forOthers.length
      ? el('p', { class: 'hint', style: 'margin:8px 0 0',
          // The subject of the sentence is the amount, not the count, so it
          // stays singular however many spends it came from.
          text: fmtSheetCur(forOthersTotal) + ' across ' + forOthers.length
            + (forOthers.length === 1 ? ' spend' : ' spends') + ' made for somebody else is left '
            + 'out of this page entirely. That money passed through rather than being spent, so '
            + 'counting it would make a tag look like a habit it is not.' })
      : document.createTextNode(''),
    backTotal > 0
      ? el('p', { class: 'hint pf-refund-line', style: 'margin:8px 0 0',
          text: fmtSheetCur(backTotal) + ' came back in this scope'
            + (backTagged > 0 ? ', ' + fmtSheetCur(backTagged) + ' of it tagged — netted off the tag it belongs to' : '')
            + '. Refunds are out of the coverage figures above, which measure money that went out.' })
      : document.createTextNode(''),
  ]));

  if (!tags.length) {
    host.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:16px 0',
      text: 'No tags in ' + rangeLabel + '. Widen the range, or tag a few spends.' }));
    return;
  }

  // Every month in scope, so a tag's bars line up with its neighbours' and a
  // month it was absent from reads as a gap rather than being skipped.
  const scopeYms = [...new Set(scoped.map((x) => x.ym))].sort();
  const barYms = scopeYms.slice(-12);
  const sumTagTotals = round2(tags.reduce((a, t) => a + t.total, 0));

  // Sorted here rather than in the rollup: the rollup answers what each tag
  // costs, and how that gets ordered is a question for whoever is looking.
  const ordered = tags.slice().sort((a, b) => {
    if (ui._tagSort === 'count') return b.count - a.count || b.total - a.total;
    if (ui._tagSort === 'az') return a.tag.localeCompare(b.tag);
    if (ui._tagSort === 'recent') return String(b.lastYm || '').localeCompare(String(a.lastYm || '')) || b.total - a.total;
    return b.total - a.total || b.count - a.count;
  });

  host.appendChild(el('div', { class: 'tag-sortbar' }, [
    el('span', { class: 'tag-find-label', text: tags.length + (tags.length === 1 ? ' tag' : ' tags') }),
    el('div', { class: 'tag-find-mode' }, TAG_SORTS.map(([v, label]) =>
      modeBtn(label, ui._tagSort === v, () => { ui._tagSort = v; }))),
  ]));

  const list = el('div', { class: 'tag-an-list' });
  ordered.forEach((t) => {
    const share = taggedTotal > 0 ? (t.total / taggedTotal) * 100 : 0;
    const netBack = t.total < 0;
    // A handle used across most of the months in scope is a standing cost; one
    // on a single entry is a label. Worth saying which, since they want
    // completely different reactions from the reader.
    // Meaningless inside a single month: everything there happened once, in
    // one month, so "one-off" would be a statement about the filter rather
    // than about the tag.
    const cadence = scopeYms.length < 2 ? null
      : (t.months >= 3 && t.months >= Math.ceil(scopeYms.length * 0.6) ? 'every month'
        : (t.months >= 3 ? 'recurring' : (t.count === 1 ? 'one-off' : null)));
    // Where it is heading, measured against its OWN median rather than against
    // the month before - one quiet month is not a trend.
    let trend = null;
    if (t.months >= 3 && t.lastYm) {
      const latest = t.yms.get(t.lastYm) || 0;
      const rest = _median([...t.yms.entries()].filter(([k]) => k !== t.lastYm).map(([, v]) => v));
      if (rest > 0 && latest > 0) {
        const d = ((latest - rest) / rest) * 100;
        if (Math.abs(d) >= 20) trend = { up: d > 0, text: (d > 0 ? '\u2191' : '\u2193') + Math.abs(d).toFixed(0) + '%' };
      }
    }

    const open = !!_tagOpen[t.tag];
    const body = el('div', { class: 'tag-an-body' + (open ? '' : ' hidden') });
    const head = el('button', { class: 'tag-an-head' + (open ? ' is-open' : ''), type: 'button' }, [
      el('div', { class: 'tag-an-top' + (netBack ? ' is-refund' : '') }, [
        el('span', { class: 'tag-pill', text: t.tag }),
        cadence ? el('span', { class: 'tag-an-cadence', text: cadence }) : document.createTextNode(''),
        trend ? el('span', { class: 'tag-an-trend' + (trend.up ? ' is-up' : ' is-down'), text: trend.text }) : document.createTextNode(''),
        el('span', { class: 'tag-an-total', text: fmtSigned(t.total) }),
      ]),
      // One bar, not two. This row used to carry a share track as well, and
      // the two stacked read as a pair when they measure unrelated things -
      // where the tag is going, and how big it is next to the others. The
      // cloud above answers the second now, by size and by tint, so the row
      // keeps only the one the cloud cannot show.
      barYms.length > 1 ? _tagSpark(barYms, t.yms, thisYm)
        : el('span', { class: 'tag-an-track' }, [
          el('span', { class: 'tag-an-fill', style: 'width:' + Math.max(1.5, share).toFixed(1) + '%' }),
        ]),
      el('span', { class: 'tag-an-meta', text: (netBack ? 'came back' : share.toFixed(0) + '% of tagged') + ' · '
        + t.count + (t.count === 1 ? ' entry' : ' entries') + ' · ' + fmtIntCur(t.avg) + ' each · '
        + t.months + (t.months === 1 ? ' month' : ' months')
        + (t.months > 1 ? ' · ' + fmtIntCur(t.usual) + ' in a usual month' : '') }),
      el('span', { class: 'rvw-sec-chev tag-an-chev' }),
    ]);
    head.addEventListener('click', () => {
      const closed = body.classList.toggle('hidden');
      _tagOpen[t.tag] = !closed;
      head.classList.toggle('is-open', !closed);
    });

    // ---- The detail, built once and kept ----
    if (barYms.length > 1) {
      body.appendChild(_rvwMonthBars(
        barYms.map((ym) => ({ ym, amount: t.yms.get(ym) || 0, current: ym === thisYm })),
        t.months > 1 ? t.usual : 0));
    }
    if (source === 'all' && t.house > 0 && t.personal > 0) {
      body.appendChild(el('p', { class: 'hint tag-an-split' }, [
        el('i', { class: 'rvw-dot is-house' }), el('span', { text: 'household ' + fmtIntCur(t.house) }),
        el('i', { class: 'rvw-dot is-personal' }), el('span', { text: 'personal ' + fmtIntCur(t.personal) }),
      ]));
    }
    const pairs = [...t.with.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
    if (pairs.length) {
      body.appendChild(el('div', { class: 'tag-an-with' }, [
        el('span', { class: 'tag-an-with-label', text: 'Usually with' }),
        // Tappable: seeing that "weekly" turns up on half of these is the
        // moment you want to look at the two together, and this is that tap.
        el('span', { class: 'tag-row' }, pairs.map(([o, n]) => el('button', {
          type: 'button', class: 'tag-pill is-tappable', text: o + ' · ' + n,
          title: 'Find spends tagged ' + t.tag + ' and ' + o,
          onclick: () => { ui._tagPicked = new Set([t.tag, o]); ui._tagMatchAll = true; rerender(); },
        }))),
      ]));
    }
    const rows = t.rows.slice().sort((a, b) => String(b.r.date || '').localeCompare(String(a.r.date || '')));
    const entries = el('div', { class: 'msheet tag-an-entries' });
    rows.slice(0, 40).forEach((x) => entries.appendChild(_tagEntryRow(x, cardName, false)));
    if (rows.length > 40) {
      entries.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:10px 0;margin:0',
        text: '+' + (rows.length - 40) + ' older entries not listed' }));
    }
    body.appendChild(entries);

    list.appendChild(el('section', { class: 'tag-an-sec' }, [head, body]));
  });
  host.appendChild(list);

  // The one arithmetic surprise on this page, said out loud.
  if (sumTagTotals > taggedTotal + 0.5) {
    host.appendChild(el('p', { class: 'hint tag-an-foot',
      text: 'The tag totals come to ' + fmtSheetCur(sumTagTotals) + ', more than the ' + fmtSheetCur(taggedTotal)
        + ' tagged, because an entry can carry up to ' + TAG_MAX + ' tags and counts in full under each one. '
        + 'Read a tag against the others, not as a slice of a pie.' }));
  }
}

// ---------- Expense section page (Credit Card | Allocation | Expense) ----------
export async function renderHomeExpense() {
  // Does nothing unless the Expense section is actually on screen. The spend
  // form can be opened from the FAB on HOME, and its save calls back here to
  // refresh the Tracker — which used to repaint a hidden view and, worse,
  // reset the FABs from `_expTab` (still 'cc' when the section was never
  // opened), so Home was left showing the add-credit-card button. Which FAB
  // belongs to which screen is applyAppMode's business, not this function's.
  // Credit Cards has its own screen now; its saves still call this to refresh.
  if (state.appMode === 'cc') { renderCc(); return; }
  if (state.appMode !== 'expense') return;
  if (ui._expTab === 'cc') ui._expTab = 'tracker';

  const host = $('#expenseView');
  host.innerHTML = '';
  updateExpNavActive();
  $('#ccAddBtn').classList.add('hidden');
  $('#spendAddBtn').classList.toggle('hidden', ui._expTab !== 'tracker');

  const token = ++ui._expRenderToken;
  if (ui._expTab === 'alloc') { await renderAllocation(host, token); return; }
  if (ui._expTab === 'tracker') { await renderSpendTracker(host, token); return; }
  if (ui._expTab === 'review') { await renderReview(host, token); return; }
  await renderExpenseSheet(host, token);
}

// Expense-sheet money formatting: whole rupees when the figure IS whole,
// otherwise two decimals. Sources like the emergency fund's available cash come
// out fractional, and rounding those away would make a box disagree with the
// number printed above it.
// Two decimal places, and never 0.1 + 0.2 = 0.30000000000000004.
export const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const _msheetCurFmt2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtSheetCur = (n) => {
  const v = round2(n);
  return Number.isInteger(v) ? fmtIntCur(v) : _msheetCurFmt2.format(v);
};

// A committed row's box holds an ADDITIVE EXPRESSION, not a single number:
// "2000+5000" keeps what was added and when, instead of collapsing to 7000 the
// moment it's entered. Fetch appends its figure as another term. The row's
// headline is the sum.
//
// Parsed by pulling out every signed number rather than evaluating: the input
// is user text, and a regex sum can't be tricked into running anything. A bare
// "-500" term still subtracts, so a correction doesn't need a separate field.
const sumExpr = (s) => {
  const parts = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?/g);
  return parts ? round2(parts.reduce((a, b) => a + Number(b), 0)) : 0;
};
// Trailing zeros off, so an appended term reads "+5000" not "+5000.00".
const exprTerm = (n) => String(round2(n));
// Clamp every term in an expression to 2dp, leaving the "+" structure alone.
// Sources are computed by float arithmetic (the emergency fund's available cash
// especially), and earlier versions stored the raw sum — so a box could hold
// "140600.25999999999". Applied on read AND on save, so those clean themselves
// up the next time the month is touched, with no migration.
const normaliseExpr = (s) => String(s == null ? '' : s).replace(/-?\d+(?:\.\d+)?/g, (m) => String(round2(m)));

// ---------- Sheet rows that are really a LIST ----------
//
// Two rows on the monthly sheet are not one figure but several, and a single
// box cannot say what they are:
//
//   * VIRTUAL BALANCE - money other people are holding. Lent, fronted, owed.
//     It stops being virtual the moment somebody hands it over, when it moves
//     into In Hand. One number cannot be settled a piece at a time and cannot
//     say who is holding what.
//   * OTHER EXPENSE - the month's unrelated one-offs. A repair, a gift, a fee.
//     It used to be a running total typed as "2000+5000", which recorded the
//     amounts and nothing about what they were, so a month later the figure
//     could not be explained.
//
// In both the headline is the total and the useful record is the parts. Same
// machinery for both, described by this table: where the list is stored, what
// the old single figure was called, and the words the form needs.
const SHEET_LISTS = {
  virtual: {
    key: 'virtualItems', legacy: 'virtualBalance', title: 'Virtual balance',
    rowLabel: 'Virtual Bal', totalLabel: 'Virtual balance',
    itemPlaceholder: 'Who has it', itemAria: 'Who has it',
    blurb: 'Money somebody else is holding — lent out, fronted, or owed to you. '
      + 'It counts towards this month like cash does. When it is actually paid back, remove the row: '
      + 'the amount is in your hand from then on, so it belongs in In Hand instead.',
    empty: 'Nobody owes you anything this month.',
    totalCls: 'is-credit',
    rowEmpty: 'tap + to add who owes you',
    btnTitle: 'Who owes you this month',
    savedNone: 'Virtual balance cleared',
  },
  other: {
    key: 'otherItems', legacy: 'otherExpense', title: 'Other expense',
    rowLabel: 'Other Expense', totalLabel: 'Other expense',
    itemPlaceholder: 'What for', itemAria: 'What for',
    blurb: 'The one-offs that belong to none of the rows above — a repair, a gift, a fee, a fine. '
      + 'The figure on the sheet is the total of what is listed here, so a month can still be '
      + 'explained line by line long after it has closed.',
    empty: 'Nothing else this month.',
    totalCls: 'is-debit',
    rowEmpty: 'tap + to itemise',
    btnTitle: 'What else went out this month',
    savedNone: 'Other expense cleared',
  },
  // Loans the person already has (home, car, personal). One entry per loan, with a Paid button on each. Paid means the
  // loan is settled: it drops below as a struck-through previous loan with the date it was paid, is no longer counted
  // in the month's loan total, and does not carry into the next month.
  // Separate from the Emergency Fund's loans, which are for money the fund lends out in future.
  loan: {
    key: 'loanItems', legacy: 'loan', title: 'Existing loans',
    rowLabel: 'Loan', totalLabel: 'Loan repayments',
    itemPlaceholder: 'Which loan', itemAria: 'Which loan',
    blurb: 'Loans you already have: home, car, personal. Add each one with what you pay each month. '
      + 'Tap Paid when a loan is settled: it moves below as a previous loan with its paid date and stops counting. '
      + 'The Emergency Fund\u2019s loans are separate: those are for future needs.',
    empty: 'No existing loans this month.',
    totalCls: 'is-debit',
    rowEmpty: 'tap + to add your loans',
    btnTitle: 'Your existing loans this month',
    savedNone: 'Loans cleared',
    paidToggle: true,
  },
};

// Kept on the month's own sheet row like every other figure there, so a past
// month keeps the picture as it stood.
function sheetItemsOf(sheet, cfg) {
  const raw = sheet && sheet[cfg.key];
  if (Array.isArray(raw)) {
    return raw
      .map((it) => ({
        label: String((it && it.label) || '').trim(),
        amount: round2(Number(it && it.amount) || 0),
        // Which spend put this row here, when one did. Carried through every
        // read and write of the list so that editing that spend can move its
        // own row and leave every hand-written one alone.
        srcId: it && it.srcId != null ? it.srcId : null,
        // Only the loans list uses this: the repayment has gone out this month.
        paid: !!(it && it.paid),
        paidOn: it && it.paidOn ? String(it.paidOn).slice(0, 10) : null,
      }))
      .filter((it) => it.label || it.amount);
  }
  // A month written while this was a single figure keeps that figure, as one
  // entry. Dropping it would quietly change that month's closing balance.
  // Other Expense arrives as an expression ("2000+5000"); sumExpr reads both
  // that and a plain number, and the sum is what the sheet was using anyway.
  const legacy = sumExpr(sheet && sheet[cfg.legacy]);
  return legacy ? [{ label: 'Carried over', amount: legacy }] : [];
}
const sheetItemsTotal = (items) => round2((items || []).reduce((a, it) => a + (Number(it.amount) || 0), 0));

// One row per person or reason: what it is, and how much. Rows are added as
// things happen and removed when they stop being true.
function openSheetListForm(ym, sheet, cfg, monthLabel, onSaved) {
  const rows = sheetItemsOf(sheet, cfg).map((it) => ({ label: it.label, amount: it.amount, srcId: it.srcId, paid: it.paid, paidOn: it.paidOn }));
  const wrap = el('div', { class: 'vb-rows' });
  // Green reads as money coming in, and only one of these two is. A running
  // total that colours a repair bill like income is worse than uncoloured.
  const totalEl = el('span', { class: 'vb-total-val ' + (cfg.totalCls || '') });
  const inputs = [];

  const syncTotal = () => {
    let sum = 0;
    inputs.forEach(({ amt }) => { sum = round2(sum + (num(amt.value) || 0)); });
    totalEl.textContent = fmtSheetCur(sum);
  };
  // Values are read back out of the boxes before any redraw, so a half-typed
  // row is not thrown away by adding or removing another one.
  const syncRows = () => {
    inputs.forEach(({ ix, lbl, amt }) => {
      // Keeps what the box does not show (the spend it came from, whether it is paid).
      rows[ix] = Object.assign({}, rows[ix], { label: lbl.value, amount: round2(num(amt.value) || 0) });
    });
  };

  const draw = () => {
    wrap.innerHTML = '';
    inputs.length = 0;
    const settled = [];
    rows.forEach((r, ix) => {
      if (r == null) return;
      // A settled loan is kept below, read-only, and never counted.
      if (cfg.paidToggle && r.paid) { settled.push({ r, ix }); return; }
      const lbl = el('input', { type: 'text', class: 'vb-label', value: r.label || '',
        placeholder: cfg.itemPlaceholder, 'aria-label': cfg.itemAria });
      const amt = el('input', { type: 'number', inputmode: 'decimal', step: 'any', class: 'vb-amt',
        value: r.amount ? r.amount : '', placeholder: '0', 'aria-label': 'Amount' });
      amt.addEventListener('input', syncTotal);
      inputs.push({ ix, lbl, amt });
      const paidBtn = cfg.paidToggle ? el('button', {
        class: 'vb-paid', type: 'button', text: 'Paid',
        title: 'Mark this loan as settled',
        onclick: () => { syncRows(); rows[ix].paid = true; rows[ix].paidOn = todayISO(); draw(); },
      }) : null;
      // filter(Boolean): only the loans list has a Paid button, and a null child here would break the whole form.
      wrap.appendChild(el('div', { class: 'vb-row' + (cfg.paidToggle ? ' has-paid' : '') }, [
        lbl, amt, paidBtn,
        el('button', {
          class: 'icon-btn vb-del', type: 'button', text: '×',
          title: 'Remove this entry', 'aria-label': 'Remove this entry',
          onclick: () => { syncRows(); rows[ix] = null; draw(); },
        }),
      ].filter(Boolean)));
    });
    if (!inputs.length) {
      wrap.appendChild(el('p', { class: 'hint', style: 'margin:0', text: cfg.empty }));
    }
    if (settled.length) {
      wrap.appendChild(el('div', { class: 'vb-prev-head', text: 'Previous loans' }));
      settled.forEach(({ r, ix }) => wrap.appendChild(el('div', { class: 'vb-row vb-prev' }, [
        el('span', { class: 'vb-prev-name', text: r.label }),
        el('span', { class: 'vb-prev-amt', text: fmtSheetCur(r.amount) }),
        el('span', { class: 'vb-prev-date', text: 'Paid ' + (r.paidOn ? _spendDayLabel(r.paidOn) : '') }),
        el('button', {
          class: 'icon-btn vb-prev-undo', type: 'button', text: 'Undo', title: 'Move this loan back to your active loans',
          onclick: () => { syncRows(); rows[ix].paid = false; rows[ix].paidOn = null; draw(); },
        }),
      ])));
    }
    syncTotal();
  };

  const addRow = () => {
    syncRows();
    rows.push({ label: '', amount: 0 });
    draw();
    const last = inputs[inputs.length - 1];
    if (last) last.lbl.focus();
  };
  draw();

  const save = async () => {
    syncRows();
    // A row with neither a name nor an amount is a blank line, not an entry.
    const items = rows.filter(Boolean)
      .map((r) => ({ label: String(r.label || '').trim(), amount: round2(Number(r.amount) || 0),
        srcId: r.srcId != null ? r.srcId : null, paid: !!r.paid, paidOn: r.paid ? (r.paidOn || todayISO()) : null }))
      .filter((r) => r.label || r.amount > 0);
    if (items.some((r) => !r.label)) { toast('Every entry needs a name'); return; }
    if (items.some((r) => r.amount <= 0)) { toast('Every entry needs an amount'); return; }
    const patch = { ym, updatedAt: new Date().toISOString() };
    patch[cfg.key] = items;
    // The old single figure is cleared once the list owns the number, so the
    // two can never both be read and disagree.
    patch[cfg.legacy] = null;
    patch[cfg.legacy + 'Src'] = null;
    await DB.put('monthlySheet', Object.assign({}, sheet, patch));
    closeModal();
    toast(items.length
      ? fmtSheetCur(sheetItemsTotal(items)) + ' across ' + items.length + (items.length === 1 ? ' entry' : ' entries')
      : cfg.savedNone);
    if (onSaved) onSaved();
  };

  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: cfg.title + ' · ' + monthLabel }),
      el('p', { class: 'hint', text: cfg.blurb }),
      wrap,
      el('div', { class: 'vb-add' }, [
        el('button', { class: 'btn small primary', type: 'button', text: '+ Add entry', onclick: addRow }),
      ]),
      el('div', { class: 'vb-total' }, [
        el('span', { class: 'vb-total-label', text: cfg.totalLabel }),
        totalEl,
      ]),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ])]),
  ]));
}

// Opens the existing-loans list for a month (the Get started card lands here).
export async function openLoanEntries() {
  const now = new Date();
  const ym = ui._expSheetYm || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
  const mod = await import('./credit.js');
  const sheet = (await DB.get('monthlySheet', ym).catch(() => null)) || { ym };
  openSheetListForm(ym, sheet, SHEET_LISTS.loan, mod.monthLabel(ym), () => renderHomeExpense());
}

// ---------- A personal spend for somebody else, paid by UPI ----------
//
// On a card this is already handled: every "for others" card spend counts into
// that cycle's reimbursement, because a bill is coming and somebody else is
// going to settle their share of it.
//
// Paid by UPI there is no bill for it to land on. The money simply left, and
// what is left behind is a person owing you — which is precisely what Virtual
// Bal is a list of. So the spend writes itself a row there, labelled with its
// category and whatever tags it carries, rather than being typed twice.
//
// Linked by srcId, and that link is what keeps this from fighting the user:
// editing the spend moves its own row, deleting the spend takes it away, and
// a row removed by hand — the way this list is meant to be used the day
// somebody pays you back — is never put back by a later edit.
const owedLabel = (rec) => [String(rec.category || 'Misc')].concat(tagsOf(rec)).join(' - ');
export const isOwedRow = (rec) => !!(rec && rec.forOthers) && rec.method !== 'Card' && Number(rec.amount) > 0;

export async function syncOwedRow(rec, id, wasOwed) {
  const cfg = SHEET_LISTS.virtual;
  const ym = String((rec && rec.ym) || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym) || id == null) return;
  const owed = isOwedRow(rec);
  if (!owed && !wasOwed) return;                 // never was one, still is not

  const sheet = (await DB.get('monthlySheet', ym).catch(() => null)) || { ym };
  const items = sheetItemsOf(sheet, cfg);
  const at = items.findIndex((it) => it.srcId === id);

  if (owed) {
    const row = { label: owedLabel(rec), amount: round2(Number(rec.amount) || 0), srcId: id };
    if (at >= 0) items[at] = row;
    else if (!wasOwed) items.push(row);          // newly owed: a row is due
    else return;                                 // it had one and it was removed
  } else if (at >= 0) {
    items.splice(at, 1);
  } else return;

  const patch = { ym, updatedAt: new Date().toISOString() };
  patch[cfg.key] = items;
  patch[cfg.legacy] = null;
  patch[cfg.legacy + 'Src'] = null;
  await DB.put('monthlySheet', Object.assign({}, sheet, patch)).catch(() => {});
}

// A spend being deleted takes its row with it, if it still has one.
export async function dropOwedRow(rec) {
  if (!isOwedRow(rec) || rec.id == null) return;
  await syncOwedRow(Object.assign({}, rec, { forOthers: false }), rec.id, true);
}

// The row on the sheet: a read-only total, who or what is behind it, and the +
// that opens the list. A figure that is the sum of a list cannot also be typed
// over without one of the two becoming a lie, so there is no box here.
function sheetListRow(ym, sheet, cfg, monthLabel, cls, onSaved) {
  const items = sheetItemsOf(sheet, cfg);
  // Settled loans are shown but never counted.
  const total = sheetItemsTotal(cfg.paidToggle ? items.filter((i) => !i.paid) : items);
  const names = items.map((i) => i.label).filter(Boolean);
  const node = el('div', { class: 'msheet-row ' + cls }, [
    el('div', { class: 'msheet-label' }, [
      el('span', {}, [cfg.rowLabel, el('span', { class: 'msheet-follow', text: 'list' })]),
      el('span', { class: 'msheet-note', text: items.length
        ? items.length + (items.length === 1 ? ' entry · ' : ' entries · ')
          + (cfg.paidToggle ? items.filter((i) => i.paid).length + ' paid · ' : '')
          + names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) + ' more' : '')
        : cfg.rowEmpty }),
    ]),
    el('div', { class: 'msheet-list' }, [
      el('span', { class: 'msheet-val', text: fmtSheetCur(total) }),
      el('button', {
        class: 'cat-add-btn msheet-list-btn', type: 'button', text: '+',
        title: cfg.btnTitle, 'aria-label': 'Edit ' + cfg.title + ' entries',
        onclick: (e) => { e.stopPropagation(); openSheetListForm(ym, sheet, cfg, monthLabel, onSaved); },
      }),
    ]),
  ]);
  return { node, items, total };
}

// ---------- Monthly cash-flow sheet (Expense → Expense tab) ----------
// One month at a time: what came in, what's committed out, what's left.
//
// Almost every row is READ LIVE from the surface that owns it rather than
// re-entered here — Allocation owns the plan, Credit Card owns the month's
// reimbursement, Emergency owns the fund. Only the three figures no other
// surface knows (virtual balance, loan, this month's own spending) are typed
// in, and those are the only ones stored (monthlySheet, keyed by month).
//
// Allocation's per-category figures are already PER MONTH (the tab is headed
// "Annual Allocations" and totals them as annual, but the amounts themselves
// are a monthly plan), so they're carried across as-is — no scaling.
async function renderExpenseSheet(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  // The sheet runs from the month it went into use to the CURRENT month, and no
  // further: a future month has no card statement, no spending and no fund
  // balance behind it, so stepping into one would only ever show a hollow copy
  // of the plan. Clamped rather than merely hidden, so a stale _expSheetYm
  // (left behind by a month rolling over mid-session) can't strand the tab on
  // an out-of-range month.
  const months = mod.monthRangeYm(EXPENSE_START_YM, thisYm);
  if (!months.length) months.push(thisYm); // clock set before the start month
  if (!ui._expSheetYm || !months.includes(ui._expSheetYm)) ui._expSheetYm = months[months.length - 1];
  const ym = ui._expSheetYm;
  const year = Number(ym.slice(0, 4));

  const [allocs, reimb, sheetRow, ef, spendRows, efLoans] = await Promise.all([
    DB.all('allocations').catch(() => []),
    ccReimbursements().catch(() => ({ map: {}, detail: new Map() })),
    DB.get('monthlySheet', ym).catch(() => null),
    efLoad().catch(() => null),
    DB.byIndex('spends', 'ym', ym).catch(() => []),
    DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
  ]);
  if (expRenderStale(token)) return;
  const alloc = (allocs || []).find((a) => Number(a.year) === year) || null;
  const sheet = sheetRow || {};

  // What the Tracker tab has left in the household kitty for this month —
  // House Exp (plus others' contribution), less everything logged against it. Feeds the Monthly
  // Expense row so the two surfaces can't disagree about the same figure.
  const kitty = _kittyFor(ym, allocs, efLoans);
  const kittySpent = round2((spendRows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const kittyLeft = round2(kitty - kittySpent);
  const efAvail = ef ? round2(Math.max(0, ef.c.cashInHand)) : 0;
  // The same figure the Credit Card tab shows: household card spends plus
  // personal ones made for somebody else, over each card's own cycle.
  const reimbAmt = round2((reimb && reimb.map && reimb.map[ym]) || 0);
  const reimbBits = (reimb && reimb.detail && reimb.detail.get(ym)) || null;
  // Card bills marked paid on the Credit Card tab. A statement is named for the
  // month it closes in, which is the month it is paid in, so it belongs on
  // THIS month's sheet.
  const cardPaid = round2((reimb && reimb.paid && reimb.paid[ym]) || 0);

  // Allocation figures are already monthly — used as entered.
  const perMonth = (key) => (alloc ? Number(alloc[key]) || 0 : 0);
  const planNote = alloc ? year + ' allocation' : 'no ' + year + ' allocation';

  // ---- The committed (red) rows ----
  // `source` is the live figure the owning surface reports for this month, or
  // null for the two nothing else knows about. Every one of these carries an
  // editable box holding a RUNNING TOTAL the user accumulates into — Fetch adds
  // the source on top of whatever's already there, so pulling twice in a month
  // records both. The row's headline number is that box.
  const debitRows = [
    // Follows the month's combined card reimbursement, which card spends on
    // the Tracker add to themselves — so logging one flows straight through
    // to here. Out of Fetch for the same reason EMI / EF is: already live.
    { key: 'nextMonthDue', label: 'Next Month Due', source: null, single: true, fallback: reimbAmt,
      note: 'card reimbursement · ' + fmtSheetCur(reimbAmt)
        + (reimbBits && reimbBits.auto && reimbBits.others > 0
          ? ' (house ' + fmtSheetCur(reimbBits.house) + ' + others ' + fmtSheetCur(reimbBits.others) + ')' : '') },
    // Follows the Emergency Fund's own available cash, so the two can't
    // disagree. `source: null` keeps it out of Fetch — there is nothing to
    // pull when the figure is already live — while staying overridable for a
    // month the fund was actually drawn on.
    { key: 'emiEf', label: 'EMI / EF', source: null, single: true, fallback: efAvail,
      note: ef ? 'emergency fund · ' + fmtSheetCur(efAvail) : 'you enter' },
    // A list now (one entry per loan, each with a Paid button); its total is the row's figure.
    { key: 'loan', label: 'Loan', list: true, source: null, note: '' },
    { key: 'home', label: 'Parents', source: perMonth('home'), note: planNote },
    { key: 'mf', label: 'Mutual Fund', source: perMonth('mf'), note: planNote },
    { key: 'indStock', label: 'Ind Stock', source: perMonth('indStock'), note: planNote },
    { key: 'usStock', label: 'US Stock', source: perMonth('usStock'), note: planNote },
    { key: 'metal', label: 'Metal', source: perMonth('metal'), note: planNote },
    // `single` rows are one editable figure with no accumulation box: nothing
    // fetches into them, so there'd be no list of terms to keep. Monthly
    // Expense defaults to whatever the Tracker has left in the kitty, and is
    // overridable for a month that didn't work out that way.
    { key: 'monthlyExpense', label: 'Monthly Expense', source: null, single: true, fallback: kittyLeft,
      note: kitty > 0 ? 'tracker balance · ' + fmtSheetCur(kittyLeft) : 'you enter' },
  ];
  // Boxes are stored as text ("2000+5000"), but earlier months were written as
  // plain numbers — String() covers both, and sumExpr reads either. Normalised
  // on the way out so a box written before term-rounding existed (the emergency
  // fund's cash arrives as 140600.25999999999) reads back at 2dp.
  const exprOf = (r) => normaliseExpr(sheet[r.key]);
  // sumExpr on BOTH kinds, deliberately: a row that used to accumulate "+"
  // terms and is now a single figure still has months holding "70300+70300" on
  // record, and Number() on that is NaN — which would have silently read as
  // zero and quietly changed those months' closing balance.
  // A `single` row shows its live source while it is following, and its own
  // figure once it has genuinely been overridden.
  const boxOf = (r) => (r.list
    ? sheetItemsTotal(sheetItemsOf(sheet, SHEET_LISTS.loan).filter((i) => !i.paid))
    : r.single
      ? (followsSource(r.key, sheet[r.key]) ? round2(r.fallback || 0) : sumExpr(sheet[r.key]))
      : sumExpr(exprOf(r)));

  // ---- Month stepper + the shared Fetch ----
  // Steps within the known range only. While the range IS one month (the sheet
  // has only just started) the arrows are left out entirely rather than shown
  // permanently dead — they reappear on their own once a second month exists.
  const monthIx = months.indexOf(ym);
  const multiMonth = months.length > 1;
  const monthLabelEl = el('span', { class: 'msheet-month-label', text: mod.monthLabel(ym) });
  const step = (delta) => {
    const next = months[monthIx + delta];
    if (!next) return;
    ui._expSheetYm = next;
    renderHomeExpense();
  };

  // Pulls every committed row that HAS a live source, APPENDING it to that
  // row's expression as another "+" term rather than collapsing the box to a
  // single total — so the box keeps a visible record of what was added.
  // Loan and Monthly Expense have no source to pull, so they're left alone.
  // Confirmed first because it's additive: running it twice by mistake would
  // silently double the month, and there's no undo.
  const fetchable = debitRows.filter((r) => r.source != null && r.source > 0);
  const appended = (r) => {
    const cur = exprOf(r).trim();
    return cur === '' ? exprTerm(r.source) : cur + '+' + exprTerm(r.source);
  };
  const fetchAll = async () => {
    if (!fetchable.length) { toast('Nothing to fetch for ' + mod.monthLabel(ym)); return; }
    const lines = fetchable.map((r) => '  • ' + r.label + ':  ' + appended(r) + '  =  ' + fmtSheetCur(boxOf(r) + r.source));
    const ok = (await appConfirm(
      'Add this month\'s figures into ' + mod.monthLabel(ym) + '?\n\n' + lines.join('\n')
      + '\n\nThis ADDS to what each box already holds — running it again will add them a second time.'
    ));
    if (!ok) return;
    const patch = { ym, updatedAt: new Date().toISOString() };
    fetchable.forEach((r) => { patch[r.key] = appended(r); });
    await DB.put('monthlySheet', Object.assign({}, sheet, patch));
    toast('Fetched ' + fetchable.length + ' value' + (fetchable.length === 1 ? '' : 's'));
    renderHomeExpense();
  };

  // A month that has never been opened gets its figures pulled in on the spot,
  // so rolling into a new month doesn't start on a blank sheet nobody
  // remembered to fill. Unlike the button this doesn't ask: it only ever fires
  // when the month has NO stored row at all, so there is nothing it could
  // double, and it can't fire twice because writing the row settles the
  // condition. Past months are left alone — auto-filling one the user
  // deliberately skipped would invent history.
  // Virtual entries carry into a new month for the same reason they exist: a
  // debt is not settled by a calendar turning over. They ride the same one-shot
  // seed as the fetched figures, and are removed by hand from the form once the
  // money actually arrives.
  const prevD = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYmSheet = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
  const prevSheet = (!sheetRow && ym === thisYm)
    ? await DB.get('monthlySheet', prevYmSheet).catch(() => null) : null;
  if (expRenderStale(token)) return;
  // Only the virtual list carries: an unpaid debt is still unpaid in a new
  // month, whereas last month's repair bill is not this month's.
  const carried = prevSheet ? sheetItemsOf(prevSheet, SHEET_LISTS.virtual) : [];
  // Existing loans recur: last month's unpaid loans carry over.
  let carriedLoans = prevSheet
    ? sheetItemsOf(prevSheet, SHEET_LISTS.loan).filter((it) => !it.paid).map((it) => ({ label: it.label, amount: it.amount, srcId: null, paid: false, paidOn: null }))
    : [];
  if (!sheetRow && ym === thisYm && (fetchable.length || carried.length || carriedLoans.length)) {
    const seed = { ym, updatedAt: new Date().toISOString() };
    fetchable.forEach((r) => { seed[r.key] = exprTerm(r.source); });
    if (carried.length) seed.virtualItems = carried;
    if (carriedLoans.length) seed.loanItems = carriedLoans;
    await DB.put('monthlySheet', seed);
    if (expRenderStale(token)) return;
    toast(mod.monthLabel(ym) + ' started — '
      + (fetchable.length ? 'figures fetched' : 'sheet opened')
      + (carried.length ? ', ' + carried.length + ' virtual carried over' : ''));
    renderHomeExpense();
    return;
  }

  const prevBtn = el('button', { class: 'icon-btn', type: 'button', text: '◀', onclick: () => step(-1) });
  const nextBtn = el('button', { class: 'icon-btn', type: 'button', text: '▶', onclick: () => step(1) });
  prevBtn.disabled = monthIx <= 0;
  nextBtn.disabled = monthIx >= months.length - 1;
  host.appendChild(el('div', { class: 'msheet-head' }, [
    el('div', { class: 'msheet-stepper' }, multiMonth
      ? [prevBtn, monthLabelEl, nextBtn]
      : [monthLabelEl]),
    el('button', { class: 'btn ghost small msheet-fetch', type: 'button', text: '↻ Fetch', onclick: fetchAll }),
  ]));

  // ---- Rows ----
  const table = el('div', { class: 'msheet' });
  let credits = 0;

  // Saving a derived row records WHAT THE SOURCE SAID at the time, in
  // `<key>Src`. That one extra number is what separates the two things a typed
  // figure can mean:
  //
  //   typed 2,500 while the reimbursement was 2,500  -> a copy. Still meant to
  //     follow, so when the reimbursement moves to 3,500 the row moves with it.
  //   typed 9,999 while the reimbursement was 2,500  -> a real override, meant
  //     to stay put whatever the reimbursement does next.
  //
  // Without it there is no way to tell them apart, and every row that was ever
  // touched froze for good - which is exactly the bug this fixes.
  const saveField = async (key, value, srcAtSave) => {
    const patch = { ym, [key]: value, updatedAt: new Date().toISOString() };
    if (srcAtSave !== undefined) patch[key + 'Src'] = value == null ? null : round2(srcAtSave || 0);
    // Field history: what this box held just before, dated to when it
    // changed - last 5, newest first, same shape the vault's own password
    // history uses, so "when did I change what" has one answer across the
    // app rather than a different convention per surface. Compared as
    // NUMBERS (sumExpr), not raw text, so rewriting "7000" as "2000+5000"
    // isn't logged as a change when the two add up the same.
    const prevRaw = sheet[key];
    const prevNum = (prevRaw == null || String(prevRaw).trim() === '') ? null : sumExpr(prevRaw);
    const nextNum = (value == null || String(value).trim() === '') ? null : sumExpr(String(value));
    if (prevNum != null && prevNum !== nextNum) {
      const hist = Array.isArray(sheet[key + 'Hist']) ? sheet[key + 'Hist'] : [];
      // `raw` keeps the actual stored text (e.g. "2000+5000"), not just its
      // sum - Loan through Metal are accumulating boxes, and a history that
      // only ever showed the total would lose exactly the thing those boxes
      // exist to keep (what was added and when). Harmless for the single-
      // figure rows too: their raw IS just the number, so nothing extra shows.
      patch[key + 'Hist'] = [{ value: prevNum, raw: prevRaw == null ? null : String(prevRaw), changedAt: new Date().toISOString() }, ...hist].slice(0, 5);
    }
    await DB.put('monthlySheet', Object.assign({}, sheet, patch));
    renderHomeExpense();
  };
  // Subtle by design - present on every field this sheet can actually save
  // (see saveField above), never calling attention to itself, but always
  // there for "when did I change this." Opens even with nothing recorded yet
  // (shows Current only) rather than only appearing once a history exists.
  // `rawCurrent`, when passed, is the box's own stored text - only the
  // accumulating rows (Loan..Metal) have one; the rest leave it undefined and
  // openSheetFieldHistory shows just the total for them, same as before.
  const historyBtn = (label, key, currentVal, rawCurrent) => el('button', {
    class: 'icon-btn msheet-history', type: 'button',
    title: label + ' history', 'aria-label': label + ' history',
    onclick: (e) => {
      e.stopPropagation();
      openSheetFieldHistory(label, currentVal, rawCurrent, Array.isArray(sheet[key + 'Hist']) ? sheet[key + 'Hist'] : []);
    },
  }, [_historyIcon()]);

  // Is this row still tracking its source, or has it been deliberately set?
  // Nothing stored at all follows. A stored figure follows only while it still
  // matches what the source read when it was saved.
  //
  // A row saved before `<key>Src` existed has no record of that, so it counts
  // as an override and keeps the figure it has - the safe reading, since the
  // alternative silently rewrites a number the user may have meant. Clearing
  // the box resumes following.
  const followsSource = (key, storedRaw) => {
    if (storedRaw == null || String(storedRaw).trim() === '') return true;
    const src = sheet[key + 'Src'];
    if (src == null || String(src).trim() === '') return false;
    return Math.abs(sumExpr(storedRaw) - (Number(src) || 0)) < 0.005;
  };

  // Green rows carry no second box: the headline figure IS the field. They hold
  // one plain number (no "+" accumulation — nothing fetches into them), so a
  // separate box under a read-only total would just be the same number twice.
  // `fallback` is what shows when nothing has been entered for this month — In
  // Hand starts from the Allocation salary but is overridable, since actual
  // take-home moves around (a bonus, a deduction) while the plan stays put.
  // `deduct` is money that has already gone OUT of this figure rather than a
  // commitment against it - a card bill settled has left the account, so what
  // is in hand is simply less. Taken off the row's own value rather than folded
  // into `fallback`, so it still applies when the user has typed their actual
  // take-home over the planned one.
  const creditInputRow = (label, key, note, fallback, hasSource, deduct) => {
    const follows = followsSource(key, sheet[key]);
    const off = round2(deduct || 0);
    // `base` is what came IN; `amount` is what is left of it after money that
    // has already gone back out. One box, showing and editing the figure that
    // matters - what is actually in hand - because a second box under a
    // read-only total would just be the same money written twice.
    const base = follows ? round2(fallback || 0) : sumExpr(sheet[key]);
    const amount = round2(base - off);
    credits += amount;
    const inp = el('input', {
      class: 'msheet-val-input',
      type: 'number', inputmode: 'decimal', step: 'any',
      value: amount, placeholder: fmtSheetCur(round2((fallback || 0) - off)),
      'aria-label': label,
    });
    inp.addEventListener('blur', () => {
      const raw = inp.value.trim();
      // Typed as what is LEFT, stored as what came in, so a bill settled after
      // this was typed still takes its own bite - and unticking one gives it
      // back. Cleared to empty means "use the planned figure again", not zero.
      const v = raw === '' ? null : round2((num(raw) || 0) + off);
      if (v !== base || raw === '') saveField(key, v, fallback);
    });
    const state = !hasSource ? document.createTextNode('')
      : follows
        ? el('span', { class: 'msheet-follow', text: 'auto' })
        : el('button', {
            class: 'msheet-follow is-override', type: 'button',
            title: 'Set by you — tap to follow ' + fmtSheetCur(fallback || 0) + ' again',
            text: 'set ↻',
            onclick: (e) => { e.stopPropagation(); saveField(key, null, fallback); },
          });
    table.appendChild(el('div', { class: 'msheet-row msheet-credit' }, [
      el('div', { class: 'msheet-label' }, [
        el('span', {}, [label, state, historyBtn(label, key, amount)]),
        // The deduction is named in the caption rather than shown as a second
        // figure, so the row still explains itself with one number on it.
        el('span', { class: 'msheet-note', text: off > 0 ? note + ' − ' + fmtSheetCur(off) : note }),
      ]),
      inp,
    ]));
  };

  // In Hand follows the Allocation salary.
  // Card bills ticked off on the Credit Card tab come straight off here: the
  // bank has taken the money, so it is not in hand any more. Read off the cards
  // rather than stored again, so unticking a bill gives it straight back.
  creditInputRow('In Hand', 'inHand',
    planNote + ' · ' + fmtSheetCur(perMonth('salary'))
      + (cardPaid > 0 ? ' · card paid' : ''),
    perMonth('salary'), true, cardPaid);
  const again = () => renderHomeExpense();
  const vRow = sheetListRow(ym, sheet, SHEET_LISTS.virtual, mod.monthLabel(ym), 'msheet-credit', again);
  credits += vRow.total;
  table.appendChild(vRow.node);

  debitRows.forEach((r) => {
    if (r.list) {
      table.appendChild(sheetListRow(ym, sheet, SHEET_LISTS.loan, mod.monthLabel(ym), 'msheet-debit', again).node);
      return;
    }
    const expr = exprOf(r);
    const boxVal = boxOf(r);
    // `single` rows edit their headline figure directly — same shape as the
    // green rows, since with nothing fetching into them a box under a
    // read-only total would just be the number twice.
    if (r.single) {
      const follows = followsSource(r.key, sheet[r.key]);
      // The figure is always IN the box, never only a placeholder. A row
      // carrying a live 3,500 used to render as an empty field with a grey
      // hint, which reads as "nothing here" rather than "this is the number".
      const inp = el('input', {
        class: 'msheet-val-input',
        type: 'number', inputmode: 'decimal', step: 'any',
        value: boxVal, placeholder: fmtSheetCur(r.fallback || 0),
        'aria-label': r.label,
      });
      inp.addEventListener('blur', () => {
        const raw = inp.value.trim();
        // Cleared means "follow the source again", not zero.
        const v = raw === '' ? null : round2(num(raw) || 0);
        if (v !== boxVal || raw === '') saveField(r.key, v, r.fallback);
      });
      // Which state the row is in, and a one-tap way out of an override. Only
      // shown where there is a source to follow: Loan and Other Expense are
      // typed figures with nothing behind them.
      const state = r.fallback == null ? document.createTextNode('')
        : follows
          ? el('span', { class: 'msheet-follow', text: 'auto' })
          : el('button', {
              class: 'msheet-follow is-override', type: 'button',
              title: 'Set by you — tap to follow ' + fmtSheetCur(r.fallback || 0) + ' again',
              text: 'set ↻',
              onclick: (e) => { e.stopPropagation(); saveField(r.key, null, r.fallback); },
            });
      table.appendChild(el('div', { class: 'msheet-row msheet-debit' }, [
        el('div', { class: 'msheet-label' }, [
          el('span', {}, [r.label, state, historyBtn(r.label, r.key, boxVal)]),
          el('span', { class: 'msheet-note', text: r.note }),
        ]),
        inp,
      ]));
      return;
    }
    // type=text, not number: a number input rejects "2000+5000" outright and
    // reports an empty value for it. inputmode=text keeps a usable keyboard on
    // mobile (the decimal pad has no "+" key).
    const inp = el('input', {
      type: 'text', inputmode: 'text', autocomplete: 'off', spellcheck: 'false',
      value: expr, placeholder: '0', 'aria-label': r.label + ' running total',
    });
    // The headline follows the box as it's typed, so the sum of an expression
    // is visible before committing it.
    const liveTotal = el('span', { class: 'msheet-val', text: fmtSheetCur(boxVal) });
    inp.addEventListener('input', () => { liveTotal.textContent = fmtSheetCur(sumExpr(inp.value)); });
    inp.addEventListener('blur', () => {
      const cleaned = normaliseExpr(inp.value.trim());
      if (cleaned !== expr) saveField(r.key, cleaned);
    });
    // The note carries the source AMOUNT, not just where it came from: the
    // headline is now the box, so without this the figure Available Balance
    // actually subtracts wouldn't appear anywhere on screen.
    const noteTxt = r.source != null ? r.note + ' · ' + fmtSheetCur(r.source) : r.note;
    table.appendChild(el('div', { class: 'msheet-row msheet-debit' }, [
      el('div', { class: 'msheet-label' }, [
        el('span', {}, [r.label, historyBtn(r.label, r.key, boxVal, expr)]),
        el('span', { class: 'msheet-note', text: noteTxt }),
      ]),
      el('div', { class: 'msheet-stack' }, [
        liveTotal,
        el('div', { class: 'msheet-input' }, [inp]),
      ]),
    ]));
  });

  // Last red row, where it always was - but a list now, for the same reason
  // Virtual Bal is one: "2000+5000" recorded the amounts and nothing about
  // what they were, so the month could not be explained afterwards.
  const oRow = sheetListRow(ym, sheet, SHEET_LISTS.other, mod.monthLabel(ym), 'msheet-debit', again);
  table.appendChild(oRow.node);

  host.appendChild(table);

  // ---- Closing balance ----
  // (In Hand + Virtual Bal) − every committed row, taken from the BOXES. The
  // boxes are what actually happened this month; the source figures are only
  // the starting suggestion Fetch pulls in, so the balance follows what's
  // recorded rather than what was planned.
  const debits = round2(debitRows.reduce((s, r) => s + boxOf(r), 0) + oRow.total);
  // Existing loans are easy to overlook, so they are taken off separately: Available Balance is what is left
  // before them, Actual Balance is what is really left once they are paid. With no loans the two are the same
  // and only one line is shown.
  const loanOwed = sheetItemsTotal(sheetItemsOf(sheet, SHEET_LISTS.loan).filter((i) => !i.paid));
  const actual = round2(credits - debits);
  const available = round2(actual + loanOwed);
  if (loanOwed > 0) {
    host.appendChild(el('div', { class: 'msheet-total' + (available < 0 ? ' is-neg' : '') }, [
      el('span', { class: 'msheet-total-label', text: 'Available Balance' }),
      el('span', { class: 'msheet-total-val', text: fmtSheetCur(available) }),
    ]));
    host.appendChild(el('div', { class: 'msheet-loan-line' }, [
      el('span', { text: '\u2212 Existing loans' }),
      el('span', { text: fmtSheetCur(loanOwed) }),
    ]));
    host.appendChild(el('div', { class: 'msheet-total msheet-actual' + (actual < 0 ? ' is-neg' : '') }, [
      el('span', { class: 'msheet-total-label', text: 'Actual Balance' }),
      el('span', { class: 'msheet-total-val', text: fmtSheetCur(actual) }),
    ]));
    host.appendChild(el('p', { class: 'hint msheet-loan-note', text: 'Loans stay out of sight, but this is your real balance. Pay them first and close them.' }));
  } else {
    host.appendChild(el('div', { class: 'msheet-total' + (actual < 0 ? ' is-neg' : '') }, [
      el('span', { class: 'msheet-total-label', text: 'Available Balance' }),
      el('span', { class: 'msheet-total-val', text: fmtSheetCur(actual) }),
    ]));
  }

  host.appendChild(explainRow('About this sheet', [
    'This sheet shows what is left of the month once everything is paid.',
    'Available Balance = In Hand + Virtual Balance \u2212 the red rows. Actual Balance also takes off your existing loans, so it is the real figure.',
    'In Hand: the money you actually have this month. It starts from your yearly plan salary. Type over it if this month was different.',
    'Virtual Balance: money you expect to receive but that has not reached your hand yet, for example an amount someone owes you. It counts like cash here until it arrives; then move it to In Hand.',
    'Other Expense: money you have to give others that fits none of the listed rows, like a repair, a gift or a fee.',
    'Red rows: what goes out this month. \u21BB Fetch fills them from your plan, and a box adds up what you type, like 2000+5000.',
  ], 'How the sheet adds up'));
}

// The accumulating boxes (Loan through Metal) store an additive EXPRESSION,
// not a single number - "2000+5000" - and sumExpr (their own totalling
// function) parses it by pulling out every signed number, not by splitting
// on "+". Mirrored here rather than a naive split so a breakdown can never
// disagree with the total shown next to it. Returns null for a plain single
// figure (nothing to break down) or fewer than 2 terms.
function _sheetExprBreakdown(raw) {
  if (raw == null) return null;
  const parts = String(raw).match(/-?\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 2) return null;
  return parts.map((p, i) => {
    const n = Number(p);
    return (n < 0 ? '− ' : (i === 0 ? '' : '+ ')) + fmtSheetCur(Math.abs(n));
  }).join('  ');
}

// A per-field timeline for the Balance sheet - same shape as the vault's own
// password history (openVaultPasswordHistory): "Current" first with its own
// dot/badge, then up to the last 5 superseded values below it, newest first.
// Reached from the subtle history icon `historyBtn` puts on every field
// renderExpenseSheet can actually save - see saveField there for where the
// history itself is recorded. Not password data, so no masking here: the
// value is shown plainly, with a copy button for pulling a past figure back
// into a note or a calculation elsewhere.
//
// `rawCurrent` - only ever set for the accumulating rows (Loan..Metal, see
// historyBtn's call site) - adds a second, smaller line under the total
// showing the actual terms that made it up ("2,000 + 5,000"), same as each
// history entry's own `raw`. The single-figure rows never pass one, so they
// show only the total, exactly as before this existed.
function openSheetFieldHistory(label, current, rawCurrent, hist) {
  // The breakdown ("2,000 + 5,000") sits on its OWN line under the value row,
  // never inside it - the value row is a flex line ending in the copy
  // button, and a variable-length expression squeezed in there would push
  // that button around instead of just wrapping cleanly underneath.
  const contentOf = (val, raw, whenNode) => {
    const breakdown = _sheetExprBreakdown(raw);
    return el('div', { class: 'vh-content' }, [
      whenNode,
      el('div', { class: 'vh-pw-row' }, [
        el('span', { class: 'vd-value vh-pw-val', text: fmtSheetCur(val) }),
        _vaultCopyBtn(label, () => String(val)),
      ]),
      breakdown ? el('div', { class: 'vh-expr', text: breakdown }) : null,
    ].filter(Boolean));
  };
  const items = [
    el('div', { class: 'vh-item vh-current' }, [
      el('div', { class: 'vh-dot' }),
      contentOf(current, rawCurrent, el('div', { class: 'vh-when' }, [el('span', { class: 'vh-current-badge', text: 'Current' })])),
    ]),
    ...hist.map((h) => el('div', { class: 'vh-item' }, [
      el('div', { class: 'vh-dot' }),
      contentOf(h.value, h.raw, el('div', { class: 'vh-when', text: h.changedAt ? new Date(h.changedAt).toLocaleString() : 'Unknown date' })),
    ])),
  ];
  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'vd-head' }, [
        el('div', { class: 'vd-head-text' }, [
          el('h2', { class: 'vd-title', text: label }),
          el('div', { class: 'vd-cat', text: 'Change history' }),
        ]),
      ]),
      el('div', { class: 'vh-timeline' }, items),
      el('p', { class: 'hint', text: hist.length
        ? 'Only the last 5 changes are kept for this box.'
        : 'No changes recorded yet for this box.' }),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ])]),
  ]));
}

// ---------- The heatmap: every month at once ----------
//
// The spreadsheet this app replaced was read this way and nothing else came
// close: one row per category, one column per month, and the colour doing the
// work. A number tells you what a month cost; a row of colour tells you which
// months were unlike the others, which is the only way an eye finds the one
// that went wrong.
//
// Each row is scaled against ITS OWN figures rather than one shared across the
// grid. Rent would otherwise be red in every column simply for being the
// biggest line in the house, and the milk would never be anything but green -
// neither of which says a thing about whether a month was unusual.
//
// Each cell is judged against the nearest EARLIER month that has an entry for
// that same category (see the call site below) - a plain month-over-month
// comparison, not the row's median. Green = down from last time, red = up.
// This was a median-vs-the-row comparison originally ("usually costs X"), but
// that reads a month as "normal" (grey) whenever it lands close to the middle
// of its own history even if it swung hard against the one month right next
// to it - which is exactly the comparison a reader's eye is actually making
// when it scans left to right. Changed 2026-09-15.
//
// Grey is reserved for the ONE case with nothing to compare against at all
// (no earlier entry for that category). Everything else gets a real verdict -
// a small dip is still green, a small rise still red, just a lighter shade of
// one than a month that doubled. Five fixed bands couldn't say that: two
// swings landing in the same band (say +20% and +48%, both "over") painted
// identically, so a genuinely bigger jump didn't read as any bigger. A
// continuous intensity (this month's % change from last, capped) fixes both
// complaints at once - no more grey-when-it-should-be-coloured, and a run of
// reds or greens now visibly varies with how far each one actually moved.
const HEAT_GREEN_RGB = '52,211,153';   // same green as --good / the old h-low2
const HEAT_RED_RGB = '248,113,113';    // same red as --bad / the old h-hi2
// A change at or beyond this magnitude is already "as coloured as it gets" -
// capping keeps one huge outlier from being the only cell with real colour
// and washing out every smaller-but-real swing sitting next to it.
const HEAT_CAP_PCT = 0.5;
// {cls} for the fixed cases (refund / no data / nothing to compare against),
// {style} for everything else - a continuously-scaled inline background, the
// same technique health.js's calendar chips already use for their own
// continuous month-colour sweep, rather than inventing a dozen more classes
// for what is genuinely a smooth scale.
const _heatCell = (amount, prev) => {
  if (amount < 0) return { cls: 'h-refund' };   // money came back - a different fact than "spent little"
  if (!(amount > 0)) return { cls: 'h-none' };
  if (!(prev > 0)) return { cls: 'h-mid' };      // nothing earlier to compare against - neutral, not a verdict
  const change = (amount - prev) / prev;
  const intensity = Math.min(1, Math.abs(change) / HEAT_CAP_PCT);
  // Floors so even a small real change still shows SOME colour (the whole
  // point of dropping the flat "normal" band), rising to a near-solid fill
  // at the cap.
  const alpha = (0.14 + intensity * 0.5).toFixed(2);
  const rgb = change <= 0 ? HEAT_GREEN_RGB : HEAT_RED_RGB;
  const strong = intensity > 0.55;
  return { style: 'background: rgba(' + rgb + ',' + alpha + ');' + (strong ? ' color: var(--text); font-weight: 700;' : '') };
};


// ---- Heatmap month click: show category popup ----
// Category breakdown for one heatmap month - the same shape a tap-open sheet
// uses everywhere else in the app (.sheet / .msheet-row), so this needed no
// CSS of its own.
function _openHeatmapMonthModal(ym, byCat, mod) {
  // In the picker's own order, matching how the grid's rows read top to
  // bottom. Only categories with an entry that month appear - a cell with
  // nothing in it has nothing to open, so it is not offered as if it did.
  const ordered = [];
  catList('spend').forEach((g) => g.items.forEach((n) => { if (byCat.has(n)) ordered.push(n); }));
  [...byCat.keys()].forEach((n) => { if (ordered.indexOf(n) < 0) ordered.push(n); });

  const monthLabel = mod.monthLabel(ym);
  const list = el('div', { class: 'msheet' });
  ordered.forEach((cat) => {
    const recs = byCat.get(cat);
    const total = round2(recs.reduce((a, r) => a + (Number(r.amount) || 0), 0));
    list.appendChild(el('div', { class: 'msheet-row trk-entry is-tappable', onclick: () => {
      _openHeatmapCatModal(cat, monthLabel, recs, ym, byCat, mod);
    } }, [
      el('div', { class: 'msheet-label' }, [
        el('span', { text: cat }),
        el('span', { class: 'msheet-note', text: recs.length + (recs.length === 1 ? ' entry' : ' entries') }),
      ]),
      el('span', { class: 'msheet-val', text: fmtSigned(total) }),
    ]));
  });
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: monthLabel }),
      list,
    ]),
    el('div', { class: 'sheet-footer' }, [
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

// One category's own entries for that month - displays date/time, tags, and
// payment method as a badge. No category repeat (all entries are the same).
// Payment method badge in top-right corner (green), amount below it.
function _openHeatmapCatModal(cat, monthLabel, recs, ym, byCat, mod) {
  const sorted = recs.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const list = el('div', { class: 'msheet' });
  sorted.forEach((r) => {
    const label = el('div', { class: 'msheet-label' }, [
      el('div', {}, [
        el('div', { style: 'font-weight: 500; margin-bottom: 4px;', text: _spendDayLabel(r.date) + (r.time ? ' · ' + r.time : '') }),
        el('div', { style: 'display: flex; gap: 4px; flex-wrap: wrap;' }, [
          ...(r.tags || []).map(t => el('span', { class: 'tag-pill', style: 'font-size: 0.75rem;', text: t })),
        ]),
      ]),
    ]);
    const rightSide = el('div', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 6px;' }, [
      r.method ? el('span', { class: 'tag-pill hm-payment-badge', style: 'font-size: 0.75rem; font-weight: 600;', text: r.method }) : document.createTextNode(''),
      el('span', { class: 'msheet-val', text: fmtSigned(r.amount) }),
    ]);
    const row = el('div', { class: 'msheet-row trk-entry', style: 'align-items: flex-start;' }, [
      label,
      rightSide,
    ]);
    list.appendChild(row);
  });
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: cat + ' · ' + monthLabel }),
      list,
    ]),
    el('div', { class: 'sheet-footer' }, [
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

// One month's raw records, grouped by category - shared by the month header
// (every category that month) and a single cell (this cell's category only,
// but still needs the full map so its own Back button can reopen the header
// view rather than crash on a missing map).
function _groupByCategory(recs) {
  const byCat = new Map();
  (recs || []).forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    if (!byCat.has(n)) byCat.set(n, []);
    byCat.get(n).push(r);
  });
  return byCat;
}

function _trkHeatmapGrid(host, yms, byYm, allocs, efLoans, thisYm, mod, now) {
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // Only months that actually hold something, plus the one in progress. A
  // column of blanks for a month before the tracker existed is noise in a view
  // whose whole job is making the non-blank cells stand out.
  const cols = yms.filter((k) => totalOf(k) > 0 || k === thisYm);
  if (cols.length < 2) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '▦' }),
      el('p', { text: 'Not enough months yet.' }),
      el('p', { class: 'hint', text: 'The heatmap compares months against each other, so it needs a '
        + 'second one before it can say anything. Tap a month above to log spends meanwhile.' }),
    ]));
    return;
  }

  // category -> ym -> amount
  const catByYm = new Map();
  cols.forEach((k) => (byYm.get(k) || []).forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    if (!catByYm.has(n)) catByYm.set(n, new Map());
    const m = catByYm.get(n);
    m.set(k, round2((m.get(k) || 0) + (Number(r.amount) || 0)));
  }));

  // In the picker's own order, so the grid reads like the form does. Anything
  // retired from the list but still sitting in an old month is kept, at the
  // end, rather than dropped along with its money.
  const ordered = [];
  catList('spend').forEach((g) => g.items.forEach((n) => { if (catByYm.has(n)) ordered.push(n); }));
  [...catByYm.keys()].forEach((n) => { if (ordered.indexOf(n) < 0) ordered.push(n); });

  const table = el('table', { class: 'heatmap cc-grid trk-heat' });
  const head = el('tr', {}, [el('th', { class: 'corner', text: 'Month' })]
    .concat(cols.map((k) => {
    const th = el('th', { class: (k === thisYm ? 'is-now' : '') + ' is-clickable hm-ym', text: mod.monthLabel(k) });
    // That month's own raw records, grouped by category - NOT catByYm, which
    // maps category -> Map(ym -> summed amount) for the heat cells above.
    // Calling .map() on one of those Maps is what crashed every render of
    // this grid: Map has no .map, so building this header threw before the
    // table ever finished, and the whole Tracker view went blank with it.
    th.onclick = () => _openHeatmapMonthModal(k, _groupByCategory(byYm.get(k)), mod);
    return th;
  })));
  const tbody = el('tbody');

  // A refund's total for the month is negative, and it is real data - not
  // the absence of any. Only an exact zero (nothing logged that cell at all)
  // gets the dash; a negative total prints signed, the same "+" convention
  // fmtSigned uses everywhere else money can come back rather than go out.
  const money = (v) => (v > 0 ? fmtIntCur(v) : v < 0 ? '+' + fmtIntCur(Math.abs(v)) : '—');
  const row = (label, cls, cells) => {
    const tr = el('tr', { class: cls || '' }, [el('th', { class: 'rowhead', text: label })]);
    cells.forEach((c) => {
      // `style`, when given, is a continuously-scaled inline background (see
      // _heatCell) - not something a fixed class list can express.
      const td = el('td', { class: (c.cls || '') + (c.onclick ? ' is-clickable' : ''), style: c.style || '', title: c.title || '', text: c.text });
      if (c.onclick) td.onclick = c.onclick;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  };

  // What went IN, first - every other row is read against it.
  const kittyOf = (k) => _kittyFor(k, allocs, efLoans);
  row('Household budget', 'trk-heat-household budget', cols.map((k) => ({ text: money(kittyOf(k)) })));

  ordered.forEach((name) => {
    const per = catByYm.get(name);
    row(name, '', cols.map((k, i) => {
      const v = per.get(k) || 0;
      // Compared against the nearest EARLIER month that actually has an
      // entry, not the row's overall median and not strictly the column
      // right before it - a gap month (nothing bought that category) would
      // otherwise either wash out a real comparison or read as a spike/drop
      // that never happened. Same "skip the gap" rule the Credit Card tab's
      // own "vs last month" already uses.
      let prevVal = 0;
      for (let j = i - 1; j >= 0; j--) {
        const pv = per.get(cols[j]) || 0;
        if (pv > 0) { prevVal = pv; break; }
      }
      // Only a cell that actually holds something opens - an empty cell
      // ("—") has nothing to show, so it stays inert rather than
      // offering a tap that lands on nothing.
      const recs = v !== 0 ? (byYm.get(k) || []).filter((r) => (r.category || 'Prev Bill Bal / Misc') === name) : null;
      const heat = _heatCell(v, prevVal);
      return {
        text: money(v),
        cls: heat.cls,
        style: heat.style,
        title: v > 0 && prevVal > 0
          ? name + ' ' + mod.monthLabel(k) + ': ' + fmtSheetCur(v) + ' · was ' + fmtIntCur(prevVal) + ' before'
          : '',
        onclick: recs && recs.length
          ? () => _openHeatmapCatModal(name, mod.monthLabel(k), recs, k, _groupByCategory(byYm.get(k)), mod)
          : null,
      };
    }));
  });

  // ---- The four summary rows ----
  //
  // Marked as a block, not styled like the categories above them. The
  // categories say where the money went; these four say whether the month
  // worked, which is a different question and the one most often being asked
  // of this grid.
  //
  // `trk-sum-top` rather than leaning on `tr.cc-sum:first-of-type`: that
  // selector means "the first TR that also has cc-sum", and the first TR in
  // this table is Kitty, so the separator it was meant to draw never appeared.
  row('Spent', 'cc-sum trk-sum-top', cols.map((k) => {
    const t = totalOf(k), b = kittyOf(k);
    return { text: money(t), cls: b > 0 ? (t > b ? 'h-hi2' : 'h-low1') : '',
      title: b > 0 ? fmtSheetCur(t) + ' of a ' + fmtSheetCur(b) + ' household budget' : '' };
  }));
  row('Left', 'cc-sum', cols.map((k) => {
    const b = kittyOf(k);
    if (!(b > 0)) return { text: '—' };
    const lf = round2(b - totalOf(k));
    return { text: fmtIntCur(lf), cls: lf < 0 ? 'h-hi2' : 'h-low2' };
  }));
  // Only the month in progress has days still to come. A closed month has none,
  // and printing 1 for it - as the sheet did - invites dividing by it.
  row('Days left', 'cc-sum trk-heat-quiet', cols.map((k) => {
    const d = _spendableDaysLeft(k, now);
    return { text: d > 0 ? String(d) : '—', title: d > 0 ? perDayLabel(d) : 'Month closed' };
  }));
  row('Per day', 'cc-sum', cols.map((k) => {
    const d = _spendableDaysLeft(k, now);
    const lf = round2(kittyOf(k) - totalOf(k));
    if (!(d > 0) || !(kittyOf(k) > 0)) return { text: '—' };
    if (lf <= 0) return { text: fmtIntCur(0), cls: 'h-hi2', title: 'Nothing left to spread' };
    return { text: fmtIntCur(perDayAllowance(lf, d)), cls: 'h-low2',
      title: fmtSheetCur(lf) + ' across ' + perDayLabel(d) };
  }));

  table.appendChild(el('thead', {}, [head]));
  table.appendChild(tbody);

  const scroll = el('div', { class: 'heatmap-scroll cc-scroll' }, [table]);
  // Opens on the newest month, and stays where it is put after that - the same
  // rule as the Credit Card grid, for the same reason.
  const gridEnd = () => Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  scroll.addEventListener('scroll', () => {
    ui._trkHeatScroll = Math.abs(scroll.scrollLeft - gridEnd()) < 4 ? null : scroll.scrollLeft;
  }, { passive: true });
  host.appendChild(scroll);
  const park = () => { scroll.scrollLeft = ui._trkHeatScroll == null ? gridEnd() : Math.min(ui._trkHeatScroll, gridEnd()); };
  park();
  requestAnimationFrame(park);

  // Rent is fixed and doesn't move the way the rest of the kitty does, so
  // lumping it into "average spend" answers a different question than the one
  // usually asked: what does the household actually get through in a normal
  // month. This is a single lifetime figure - the same across every month on
  // screen - which is why it lives once below the whole table rather than
  // repeated into the per-month Insights panel on each individual month.
  //
  // Computed as the average of (month total − that month's Rent), not as
  // (average total) − (average Rent): the two only agree if both sides divide
  // by the same number of months, and a month with nothing under Rent - before
  // it was tracked, or paid in cash that month - would otherwise drop out of
  // the Rent average's denominator and quietly inflate it. Reuses the Rent
  // row's own per-month map (catByYm) rather than re-scanning byYm.
  const rentAvgCols = cols.filter((k) => totalOf(k) > 0);
  if (rentAvgCols.length >= 2) {
    const rentByYm = catByYm.get('Rent') || new Map();
    const nonRentAvg = round2(rentAvgCols.reduce((s, k) => s + (totalOf(k) - (rentByYm.get(k) || 0)), 0) / rentAvgCols.length);
    host.appendChild(el('div', { class: 'trk-heat-avg' }, [
      el('span', { class: 'trk-heat-avg-lbl', text: '🏠 House Average Expense' }),
      el('span', { class: 'trk-heat-avg-val', text: '~' + fmtSheetCur(nonRentAvg) + ' / month' }),
      el('span', { class: 'trk-heat-avg-note', text: 'avg of ' + rentAvgCols.length + ' months' }),
    ]));
  }

  host.appendChild(el('div', { class: 'trk-heat-key' }, [
    el('span', { class: 'trk-heat-key-lbl', text: 'vs the month before' }),
    el('span', { class: 'trk-heat-swatch h-mid', text: 'no earlier month' }),
    // A gradient bar, not fixed steps - the actual cells scale continuously
    // (a bigger change = a deeper shade), so a handful of discrete swatches
    // would misrepresent the very thing this legend is explaining.
    el('span', { class: 'trk-heat-swatch trk-heat-swatch-grad',
      style: 'background: linear-gradient(90deg, rgba(' + HEAT_GREEN_RGB + ',0.14), rgba(' + HEAT_GREEN_RGB + ',0.7));',
      text: 'down · less → more' }),
    el('span', { class: 'trk-heat-swatch trk-heat-swatch-grad',
      style: 'background: linear-gradient(90deg, rgba(' + HEAT_RED_RGB + ',0.14), rgba(' + HEAT_RED_RGB + ',0.7));',
      text: 'up · less → more' }),
  ]));
  host.appendChild(explainRow('About the heatmap', [
    'One row per category, one column per month. Every row is coloured against '
      + 'ITS OWN history, not against the other rows - otherwise rent would be red in every '
      + 'column for being the biggest line in the house, and milk green in every column for being '
      + 'the smallest, and neither would tell you anything.',
    'Each cell is compared against the NEAREST EARLIER month that actually has an entry for that '
      + 'category - a gap month with nothing bought is skipped over rather than counted as a drop to '
      + 'zero. A month with nothing earlier to compare against (the first one logged) reads neutral, '
      + 'not red or green - there is nothing yet to call it against.',
    'The shade scales with how big the change actually was, not a handful of fixed steps - a small '
      + 'dip is a pale green, a month that doubled is a deep red, and two different-sized jumps no '
      + 'longer paint identically just for landing in the same rough band.',
    'Household budget is what went in that month. Spent, Left and Per day are read against it. Days left and '
      + 'Per day only apply to the month in progress - a closed month has no days still to spend.',
  ], 'How the colours are worked out'));
}


// ---------- Daily spend tracker (Expense → Tracker tab) ----------
// The household kitty for THIS month: what the budget is, what's gone, what's
// left. One row per spend (see db.js `spends`), rolled up by category here.
//
// Categories are fixed rather than free text — the whole point is that the same
// grocery run lands in the same bucket every time, which typing can't promise.
// Grouped only for the picker's sake; the group isn't stored, so regrouping
// later can't strand existing rows.
// ---------- Personal Finance ----------
//
// The Tracker in Expense is HOUSEHOLD spending, measured against a kitty of
// House Exp doubled. This is the other half of the card bill: what gets spent
// on the person rather than the house, against its own allowance.
//
// Kept apart from household spending everywhere - own store, own categories,
// own limits - because the two answer different questions and only the
// household half is credited back on a card. Mixing them is how a month's
// household total quietly starts including a haircut.
const PERSONAL_CATEGORIES = [
  { group: 'Food', items: ['Eat Out', 'Order In', 'Tea & Snacks', 'Coffee'] },
  { group: 'Shopping', items: ['Clothes', 'Footwear', 'Gadgets', 'Accessories'] },
  { group: 'Travel', items: ['Fuel', 'Cab & Auto', 'Train & Bus', 'Stay', 'Trip'] },
  { group: 'Health', items: ['Gym', 'Grooming', 'Medicine', 'Supplements'] },
  { group: 'Fun', items: ['Movies', 'Subscriptions', 'Games', 'Books', 'Outing'] },
  { group: 'Other', items: ['Gift', 'Recharge', 'Fees & Charges', 'Misc', 'Refund'] },
];

// ---------- Refund: a spend that came back ----------
//
// The one category that is not spending. A return, a cancelled booking, a
// friend settling up - money that has already been logged as gone and has now
// come back, so the month's total has to come down by it.
//
// It is stored as a NEGATIVE amount, and that is the whole implementation.
// Every figure on this section is some `reduce((a, r) => a + r.amount)` over
// the same rows - the two limits, the category roll-up, Review, what is logged
// against a card, Card check - and a negative term is already correct in all
// of them. A positive amount plus a "this one is a refund" flag would mean
// finding and fixing every one of those sums, and being wrong wherever one was
// missed.
//
// So the SIGN is what the arithmetic and the colour read, never the name: a
// category renamed later leaves its entries adding up exactly as before.
//
// The household kitty works the same way and for the same reasons - a returned
// pair of shoes and a returned grocery order are the same event - so this is
// one constant serving both sides rather than two that could drift apart.
export const REFUND_CAT = 'Refund';
export const isRefund = (r) => (Number(r && r.amount) || 0) < 0;
// What a refund reads as on screen: money back, in green, never a minus sign
// buried in a column of black figures.
const fmtRefund = (amt) => '+' + fmtSheetCur(Math.abs(Number(amt) || 0));
export const fmtSigned = (amt) => (Number(amt) < 0 ? fmtRefund(amt) : fmtSheetCur(amt));
// Card and UPI only. There is no cash line because a personal allowance is
// held on a card and a UPI handle, and a method nobody uses is one more tap
// on every entry.
export const PF_METHODS = ['Card', 'UPI'];
export const PF_START_YM = '2026-09';        // the month this started being tracked

// ---------- The two category lists, editable ----------
//
// The constants above are DEFAULTS - what a fresh install starts from - not the
// live lists. Both are editable and stored in `meta`, which keeps them inside
// backup and restore without a schema change.
//
// Household and personal stay SEPARATE. They are genuinely different
// vocabularies: one has Rent and Milk in it, the other Gym and Movies, and
// merging them would make every picker twice as long and half as useful.
export const CAT_KINDS = {
  spend: { metaKey: 'spendCategories', store: 'spends', fallback: () => SPEND_CATEGORIES, label: 'household spends' },
  pf: { metaKey: 'pfCategories', store: 'personalSpends', fallback: () => PERSONAL_CATEGORIES, label: 'personal spends' },
};
let _catLists = { spend: null, pf: null };
export let _catMaps = { spend: new Map(), pf: new Map() };

// Whatever is on record for a kind, or the built-in list until one is saved.
export const catList = (kind) => _catLists[kind] || CAT_KINDS[kind].fallback();
const _buildCatMap = (list) => {
  const m = new Map();
  (list || []).forEach((g) => (g.items || []).forEach((n) => m.set(n, g.group)));
  return m;
};
// Anything unrecognised - a category retired from the list but still sitting in
// old months - lands in Other rather than disappearing along with its money.
export const _pfGroupOf = (name) => _catMaps.pf.get(name) || 'Other';
const _spendGroupOf = (name) => _catMaps.spend.get(name) || 'Other';

// Read both lists once at boot, and again after any edit. Shape is validated on
// the way in: a hand-edited backup should not be able to put a picker into a
// state the form cannot render.
export async function loadCategoryLists() {
  for (const kind of Object.keys(CAT_KINDS)) {
    let list = null;
    try {
      const row = await DB.get('meta', CAT_KINDS[kind].metaKey);
      const raw = row && row.value;
      if (Array.isArray(raw)) {
        list = raw
          .map((g) => ({
            group: String((g && g.group) || '').trim(),
            items: Array.isArray(g && g.items)
              ? g.items.map((x) => String(x || '').trim()).filter(Boolean)
              : [],
          }))
          .filter((g) => g.group);
        if (!list.length) list = null;
      }
    } catch (_) { list = null; }
    // Refund is not an ordinary category the user curates - it is how money
    // coming back is recorded, and both tabs' arithmetic assumes it can be
    // reached. Put back in memory only, so a list saved before it existed
    // still offers it without rewriting what the user saved.
    if (list && !list.some((g) => (g.items || []).indexOf(REFUND_CAT) >= 0)) {
      const other = list.find((g) => g.group === 'Other') || list[list.length - 1];
      if (other) other.items = (other.items || []).concat([REFUND_CAT]);
    }
    _catLists[kind] = list;
    _catMaps[kind] = _buildCatMap(catList(kind));
  }
}
export async function saveCategoryList(kind, list) {
  await DB.put('meta', { key: CAT_KINDS[kind].metaKey, value: list, updatedAt: new Date().toISOString() });
  await loadCategoryLists();
}
export const _pfGroupClass = (group) => 'pf-g-' + String(group).toLowerCase().replace(/[^a-z]/g, '');

// Entries filter: 'all', 'upi', or 'card:<id>' for one card. Only the entry
// LIST is narrowed - the allowance strips above stay whole, because the card
// limit is one figure across every card and showing a single card against it
// would read as a per-card limit.
// Same render-race guard the Expense section uses: every tab here awaits a
// read, and a fast tab switch must not let a stale one paint over the new one.
export const pfRenderStale = (token) => token !== ui._pfRenderToken;

// The month's two allowances. The card figure is the Yearly plan tab's own
// "Card" line - the one place the household budget is already written down -
// so it is read live rather than copied. The UPI one has no home in that
// budget, so it is a setting of its own.
export function _pfCardLimit(ym, allocs) {
  const al = (allocs || []).find((x) => Number(x.year) === Number(String(ym).slice(0, 4)));
  return al ? round2(Number(al.card) || 0) : 0;
}
export async function _pfUpiLimit() {
  const row = await DB.get('meta', 'pfUpiLimit').catch(() => null);
  const v = row ? Number(row.value) : NaN;
  return v > 0 ? round2(v) : 0;
}

const SPEND_CATEGORIES = [
  { group: 'Fixed', items: ['Rent', 'Electricity', 'Internet', 'Water', 'GAS'] },
  { group: 'Home', items: ['Bruno Food', 'Plants / Aquarium', 'Urban/House', 'Medicine'] },
  { group: 'Grocery', items: ['Online Grocery', 'Flipkart Grocery', 'Amazon Grocery', 'Local Shop', 'Brigade', 'Milk', 'Non veg', 'Fruits'] },
  { group: 'Lifestyle', items: ['Dining', 'App Subscription', 'Cinema'] },
  { group: 'Other', items: ['Prev Bill Bal / Misc', 'Refund'] },
];
export const SPEND_METHODS = ['UPI', 'Card', 'Cash'];
// Category -> its picker group, and that group's colour class. Built from the
// same list the form uses, so a category can never drift into a group the
// picker doesn't show. Anything unrecognised (a category retired from the list
// but still sitting in old months) lands in Other rather than disappearing.
const _spendGroupClass = (group) => 'trk-g-' + String(group).toLowerCase().replace(/[^a-z]/g, '');


async function renderSpendTracker(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  // Every month is loaded, not just the selected one: the insights below
  // compare against previous months, so they need the whole history anyway —
  // and a household's spend rows are a few hundred a year, not a scale where
  // one read per month would pay for itself.
  const [allocs, allSpends, cards, efLoans] = await Promise.all([
    DB.all('allocations').catch(() => []),
    DB.all('spends').catch(() => []),
    DB.all('creditCards').catch(() => []),
    DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
  ]);
  if (expRenderStale(token)) return;
  const cardName = new Map((cards || []).map((c) => [c.id, c.name || 'Card']));

  const byYm = new Map();
  (allSpends || []).forEach((r) => {
    const k = String(r.ym || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    if (!byYm.has(k)) byYm.set(k, []);
    byYm.get(k).push(r);
  });

  // Timeline spans the tracker's start month through this one, plus any month
  // that already has entries (a back-dated spend outside the range must not
  // become unreachable).
  const timelineYms = [...new Set(mod.monthRangeYm(TRACKER_START_YM, thisYm).concat([...byYm.keys()], [thisYm]))]
    .filter((k) => k <= thisYm).sort();
  if (!timelineYms.length) timelineYms.push(thisYm);
  if (!ui._trkYm || !timelineYms.includes(ui._trkYm)) ui._trkYm = timelineYms[timelineYms.length - 1];
  const ym = ui._trkYm;
  const year = Number(ym.slice(0, 4));
  const alloc = (allocs || []).find((a) => Number(a.year) === year) || null;

  // The kitty is the House Exp allocation, plus whatever others contribute to the house.
  const share = alloc ? Number(alloc.houseExp) || 0 : 0;
  // Through _kittyFor, so this agrees with the Expense sheet and the Review
  // tab. Computing it inline here is what let the repayment earmark go missing
  // from this one surface while the other two had it.
  const drawn = _emergencyDrawIn(ym, efLoans);
  const earmark = _repayEarmarkIn(ym, efLoans);
  const budget = _kittyFor(ym, allocs, efLoans);
  const sharedIn = _sharedFor(ym, allocs);
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const spends = (byYm.get(ym) || []).slice().sort((a, b2) => String(b2.date || '').localeCompare(String(a.date || '')) || (b2.id - a.id));
  const spent = totalOf(ym);
  const left = round2(budget - spent);
  // Only meaningful for the month in progress, and only while something is
  // left - dividing an overspend across the days ahead would read as an
  // allowance. Same divisor and same rounding as Home, via the one helper.
  const daysInMonth = new Date(year, Number(ym.slice(5, 7)), 0).getDate();
  const daysRemaining = _spendableDaysLeft(ym, now);
  const perDayLeft = daysRemaining > 0 && left > 0 ? perDayAllowance(left, daysRemaining) : null;

  // ---- Month timeline, same as the Credit Card tab ----
  // Fixed under the app header while the rest scrolls, so the month picker
  // stays reachable. Header height is measured, not hardcoded — it varies with
  // the safe-area inset on notched devices.
  const appHeader = document.querySelector('.app-header');
  const timelineWrap = el('div', {
    class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline',
    style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px',
  });
  // Newest first on screen. `timelineYms` itself stays ascending — the default
  // selection takes the last entry, and the insights compare against earlier
  // months — so only the render order is flipped.
  // The heatmap sits with the months but is not one of them - the same shape as
  // the Overall chip on the stocks Overview. While it is up no month is active,
  // and saying so is the point: the figures below are about all of them.
  const heatChip = el('button', {
    type: 'button', class: 'cc-timeline-chip trk-heat-chip' + (ui._trkHeatmap ? ' active' : ''),
    text: '▦ All months',
    onclick: () => { if (ui._trkHeatmap) return; ui._trkHeatmap = true; renderHomeExpense(); },
  });
  const timelineRow = el('div', { class: 'cc-timeline' }, [heatChip].concat(
    timelineYms.slice().reverse().map((k) => el('button', {
      type: 'button',
      class: 'cc-timeline-chip'
        + (!ui._trkHeatmap && k === ym ? ' active' : '')
        + (k === thisYm ? ' is-current' : '')
        + (totalOf(k) > 0 ? ' has-data' : ''),
      text: mod.monthLabel(k),
      onclick: () => {
        if (!ui._trkHeatmap && k === ym) return;
        ui._trkHeatmap = false; ui._trkYm = k; ui._trkTimelineClicked = true; renderHomeExpense();
      },
    }))));
  timelineWrap.appendChild(timelineRow);
  host.appendChild(timelineWrap);
  _mountMonthStrip('tracker', timelineWrap, ui._trkTimelineClicked);
  ui._trkTimelineClicked = false;
  // Same swipe as the Review tab. The two share this month, so leaving one
  // swipeable and the other not would read as broken rather than deliberate.
  _attachMonthSwipe(host, timelineYms, ym, (k) => {
    // Swiping to a month is a way out of the heatmap, not a thing that happens
    // underneath it.
    ui._trkHeatmap = false; ui._trkYm = k; ui._trkTimelineClicked = true; renderHomeExpense();
  });

  if (ui._trkHeatmap) {
    _trkHeatmapGrid(host, timelineYms, byYm, allocs, efLoans, thisYm, mod, now);
    return;
  }

  // ---- Kitty / spent / left ----
  host.appendChild(el('div', { class: 'trk-summary' }, [
    el('div', { class: 'trk-sum-cell' }, [
      // The draw rides on the LABEL line as a badge. It has to be declared —
      // without it the basis below understates the figure above and reads as a
      // bug — but this cell is a third of the width, and spelling it out on the
      // basis line forced a wrap. Beside "Kitty" there is room, and the siren
      // is what the Emergency Fund is marked with everywhere else.
      el('div', { class: 'trk-sum-label trk-label-row' }, [
        el('span', { text: 'Household budget' }),
        drawn > 0
          ? el('span', { class: 'trk-draw-badge', title: 'Emergency draw added this month', text: '🚨' + fmtSheetCur(drawn) })
          : (earmark > 0
            ? el('span', { class: 'trk-draw-badge is-repay', title: 'Emergency loan repayment due this month', text: '↩' + fmtSheetCur(earmark) })
            : document.createTextNode('')),
      ]),
      el('div', { class: 'trk-sum-val', text: fmtSheetCur(budget) }),
      el('div', { class: 'trk-sum-note', text: share > 0 || sharedIn > 0
        ? (share > 0 ? fmtSheetCur(share) + ' house exp' : '') + (sharedIn > 0 ? (share > 0 ? ' + ' : '') + fmtSheetCur(sharedIn) + ' shared by others' : '') + (drawn > 0 && earmark > 0 ? ' − ' + fmtSheetCur(earmark) : '')
        : 'set House Exp for ' + year }),
    ]),
    el('div', { class: 'trk-sum-cell' }, [
      el('div', { class: 'trk-sum-label', text: 'Spent' }),
      el('div', { class: 'trk-sum-val', text: fmtSheetCur(spent) }),
      el('div', { class: 'trk-sum-note', text: spends.length + (spends.length === 1 ? ' entry' : ' entries') }),
    ]),
    el('div', { class: 'trk-sum-cell trk-left' + (left < 0 ? ' is-neg' : '') }, [
      el('div', { class: 'trk-sum-label', text: 'Left' }),
      el('div', { class: 'trk-sum-val', text: fmtSheetCur(left) }),
      // For the CURRENT month, what's left per remaining day is the figure that
      // actually guides a decision today; the percentage used is already drawn
      // as the bar underneath. Whole rupees on purpose — a daily allowance
      // quoted to the paisa is precision nobody spends to.
      el('div', { class: 'trk-sum-note', title: perDayLeft != null
        ? fmtSheetCur(left) + ' across ' + perDayLabel(daysRemaining) : '',
        text: perDayLeft != null
          ? fmtIntCur(perDayLeft) + '/day × ' + daysRemaining
          : (budget > 0 ? Math.round((spent / budget) * 100) + '% used' : '—') }),
    ]),
  ]));

  if (budget > 0) {
    const pct = Math.min(100, Math.max(0, (spent / budget) * 100));
    host.appendChild(el('div', { class: 'trk-bar' }, [
      el('div', { class: 'trk-bar-fill' + (spent > budget ? ' is-over' : ''), style: 'width:' + pct.toFixed(1) + '%' }),
    ]));
  }

  if (!spends.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '📍' }),
      el('p', { text: 'Nothing logged for ' + mod.monthLabel(ym) + ' yet.' }),
      el('p', { class: 'hint', text: share > 0 ? 'Tap "+ Add spend" each time money leaves the household household budget.' : 'Set House Exp on the Yearly plan tab first — the household budget is that figure, plus anything others contribute.' }),
    ]));
    return;
  }

  // ---- Rolled up by category, biggest first ----
  const byCat = new Map();
  spends.forEach((r) => {
    const k = r.category || 'Prev Bill Bal / Misc';
    const cur = byCat.get(k) || { total: 0, count: 0 };
    cur.total = round2(cur.total + (Number(r.amount) || 0));
    cur.count++;
    byCat.set(k, cur);
  });
  const cats = [...byCat.entries()].sort((a, b2) => b2[1].total - a[1].total);

  // Category roll-up and the raw entries are two views of the same month, not
  // two things to read together — and the entry list grows all month, so
  // stacking them buried the roll-up further every day. Segmented, defaulting
  // to the roll-up: "where did it go" is the question being asked most.
  const views = [['category', '📊 By category'], ['entries', '🧾 Entries (' + spends.length + ')']];
  host.appendChild(el('div', { class: 'seg trk-seg' }, views.map(([v, label]) =>
    el('button', {
      type: 'button', class: ui._trkView === v ? 'active' : '', text: label,
      onclick: () => { if (ui._trkView === v) return; ui._trkView = v; renderHomeExpense(); },
    }))));

  // Grouped the same way the spend form groups them, so the roll-up reads in
  // the same shape the categories were picked in. Each group carries a colour,
  // which is what makes a long list scannable — the eye finds "that's all
  // grocery" without reading a single label.
  //
  // Groups keep the picker's own order — Fixed, Home, Grocery, Lifestyle,
  // Other — rather than being ranked by spend. A fixed order means the same
  // group sits in the same place every month, so the list can be read from
  // memory; ranking by size moved everything around whenever one month
  // happened to differ. Categories WITHIN a group still lead with the biggest,
  // where the ordering is the useful part.
  const grouped = new Map();
  cats.forEach(([name, c]) => {
    const g = _spendGroupOf(name);
    if (!grouped.has(g)) grouped.set(g, { total: 0, rows: [] });
    const bucket = grouped.get(g);
    bucket.total = round2(bucket.total + c.total);
    bucket.rows.push([name, c]);
  });
  // A share is a share of money that WENT OUT, so it is measured against the
  // gross rather than against `spent`, which is net of refunds. Measured
  // against the net, a month with a refund in it had Grocery at 109% of
  // itself and the refund group at -9%, which is not a share of anything.
  const grossSpent = round2(cats.reduce((a, [, c]) => a + Math.max(0, c.total), 0));
  // Only groups that actually have entries this month. Ordered by their
  // position in SPEND_CATEGORIES, so the order can never drift from the
  // picker's; anything unrecognised sorts last.
  const groupOrder = catList('spend').map((g) => g.group);
  const rank = (name) => { const i = groupOrder.indexOf(name); return i === -1 ? groupOrder.length : i; };
  const groupList = [...grouped.entries()].sort((a, b2) => rank(a[0]) - rank(b2[0]));

  const catWrap = el('div', { class: 'trk-groups' });
  groupList.forEach(([gname, g]) => {
    const gback = g.total < 0;
    const gpct = !gback && grossSpent > 0 ? (g.total / grossSpent) * 100 : 0;
    const rows = el('div', { class: 'trk-cats' });
    g.rows.forEach(([name, c]) => {
      // A share of the month is meaningless for a line that came off it, so a
      // refund says what it is instead of quoting a negative percentage.
      const back = c.total < 0;
      const pct = !back && grossSpent > 0 ? (c.total / grossSpent) * 100 : 0;
      rows.appendChild(el('div', { class: 'trk-cat' + (back ? ' is-refund' : '') }, [
        el('div', { class: 'trk-cat-top' }, [
          el('span', { class: 'trk-cat-name' }, [
            el('span', { class: 'trk-cat-dot' }),
            el('span', { text: name }),
          ]),
          el('span', { class: 'trk-cat-amt', text: fmtSigned(c.total) }),
        ]),
        el('div', { class: 'trk-cat-bottom' }, [
          // Share of the WHOLE month, not of its group — a bar that filled up
          // inside its group would make a small group's top row look like the
          // month's biggest expense.
          el('span', { class: 'trk-cat-track' }, [
            el('span', { class: 'trk-cat-fill', style: 'width:' + Math.max(2, pct).toFixed(1) + '%' }),
          ]),
          el('span', { class: 'trk-cat-meta', text: c.count + '× · ' + (back ? 'came back' : pct.toFixed(0) + '%') }),
        ]),
      ]));
    });
    catWrap.appendChild(el('section', { class: 'trk-group ' + _spendGroupClass(gname) }, [
      el('div', { class: 'trk-group-head' + (gback ? ' is-refund' : '') }, [
        el('span', { class: 'trk-group-name', text: gname }),
        el('span', { class: 'trk-group-total', text: fmtSigned(g.total) }),
        el('span', { class: 'trk-group-pct', text: gback ? 'came back' : gpct.toFixed(0) + '%' }),
      ]),
      rows,
    ]));
  });
  // ---- Every entry, newest first ----
  // Filtered by how it was paid, and by which card. Built whether or not the
  // entries view is showing, since which one is on screen is decided below -
  // the filter row goes in the same wrapper so it travels with the list.
  const entriesWrap = el('div', {});
  const trkFilter = spendEntryFilter(spends, cards, ui._trkFilter, (v) => { ui._trkFilter = v; renderHomeExpense(); });
  ui._trkFilter = trkFilter.current;
  if (trkFilter.node) entriesWrap.appendChild(trkFilter.node);
  const shownSpends = spends.filter(trkFilter.matches);
  const trkNote = spendFilterNote(trkFilter, shownSpends);
  if (trkNote) entriesWrap.appendChild(trkNote);
  const list = el('div', { class: 'msheet' });
  shownSpends.forEach((r) => {
    list.appendChild(el('div', { class: 'msheet-row trk-entry is-tappable'
      + (isRefund(r) ? ' is-refund' : ''), onclick: () => openSpendForm(budget, r) }, [
      el('div', { class: 'msheet-label' }, [
        el('span', { text: r.category || '—' }),
        el('span', { class: 'msheet-note', text: _spendDayLabel(r.date) + ' · '
          + (r.method || 'UPI') + (r.cardId != null && cardName.has(r.cardId) ? ' (' + cardName.get(r.cardId) + ')' : '')
          + (r.note ? ' · ' + r.note : '') }),
        tagRow(r) || document.createTextNode(''),
      ]),
      el('div', { class: 'trk-entry-right' }, [
        el('span', { class: 'msheet-val', text: fmtSigned(r.amount) }),
        el('button', {
          class: 'icon-btn trk-del', type: 'button', text: '×', 'aria-label': 'Delete this spend',
          onclick: async (e) => {
            e.stopPropagation(); // the row opens the editor; the × must not
            // Every card spend is part of a month's reimbursement now, not
            // just this month's, so the warning is about the method alone.
            const billed = r.method === 'Card';
            if (!(await appConfirm('Delete ' + fmtSigned(r.amount) + ' on ' + (r.category || '—') + '?'
              + (billed ? '\n\nIt will also come off that month\'s card reimbursement.' : '')))) return;
            await DB.del('spends', r.id);
            toast('Deleted');
            renderHomeExpense();
          },
        }),
      ]),
    ]));
  });
  if (!shownSpends.length) {
    list.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:14px 0;margin:0',
      text: 'Nothing on this filter for ' + mod.monthLabel(ym) + '.' }));
  }
  entriesWrap.appendChild(list);
  host.appendChild(ui._trkView === 'entries' ? entriesWrap : catWrap);

  // ---- Insights: this month read against the ones before it ----
  // Only under the category view — they're commentary on that roll-up, and the
  // entries list is already long.
  // Wrapped: the insights are commentary, and a failure computing them must not
  // take the rest of the tab down with it. When this threw, everything after it
  // — including the footer — silently vanished, and the only visible symptom
  // was a missing panel.
  try {
    const insights = ui._trkView === 'category' ? _trackerInsights(ym, timelineYms, byYm, byCat, spent, totalOf) : [];
    if (insights.length) {
      host.appendChild(el('h3', { class: 'div-group-head', text: '💡 Insights' }));
      host.appendChild(el('div', { class: 'trk-insights' }, insights.map((it) =>
        el('div', { class: 'trk-insight' + (it.tone ? ' is-' + it.tone : '') }, [
          el('span', { class: 'trk-insight-ico', text: it.icon }),
          el('div', { class: 'trk-insight-body' }, [
            el('div', { class: 'trk-insight-head', text: it.head }),
            el('div', { class: 'trk-insight-sub', text: it.sub }),
          ]),
        ]))));
    }
  } catch (_) { /* commentary only — the month's figures above stand on their own */ }

  host.appendChild(explainRow('About the household budget', 'The household budget is the Yearly plan tab\'s House Exp, plus what someone else contributes to the house if you turned that on there. Every spend logged here comes off it. This tab always shows the current month; earlier months stay in the backup.', 'Where the household budget comes from'));
}

// 'YYYY-MM' -> "Sep '26", for form copy that has no credit.js import to hand.
export const _spendMonthLabel = (k) => {
  const m = /^(\d{4})-(\d{2})/.exec(k || '');
  return m ? _SPEND_MONS[+m[2] - 1] + " '" + m[1].slice(2) : k;
};

// This month, as 'YYYY-MM'. Card statements are only touched for the CURRENT
// month: an earlier month's bill has already been issued and very likely paid,
// so back-filling a spend into it would rewrite a statement that is closed.
const _thisSpendYm = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

// ---------- The month's card reimbursement ----------
//
// Two kinds of spend land on a card and then come back to you:
//
//   * a HOUSEHOLD spend put on the card - the kitty covers it;
//   * a PERSONAL spend marked FOR OTHERS put on the card - the person covers it.
//
// Both are money the bank billed you that is not yours to carry, which is
// exactly what credit.js means by reimbursement. Together they ARE the month's
// figure, so it is summed from the entries rather than nudged by a delta as
// each one is saved.
//
// Nudging drifted, and could only ever drift: it fired for the current month
// only, only once a card had been picked, clamped at zero so a stray reversal
// was permanent, and never saw the personal half at all. A sum cannot drift
// from the rows it is a sum of.
//
// Which month a card spend belongs to is statementYmFor, as everywhere else -
// the bill being reimbursed is the one the spend lands on, not the calendar
// month it happened in. A card spend with no card named has no cycle to sit
// in, so it falls back to its own month rather than disappearing.
export function _reimbParts(cards, houseSpends, personalSpends, mod) {
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  const parts = new Map();
  const at = (k) => {
    let p = parts.get(k);
    if (!p) { p = { house: 0, others: 0, derived: 0 }; parts.set(k, p); }
    return p;
  };
  const add = (rows, key, keep) => (rows || []).forEach((r) => {
    if (r.method !== 'Card' || !keep(r)) return;
    const card = r.cardId != null ? byId.get(r.cardId) : null;
    const ym = card ? mod.statementYmFor(r.date, card) : String(r.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    const p = at(ym);
    p[key] = round2(p[key] + (Number(r.amount) || 0));
  });
  add(houseSpends, 'house', () => true);
  add(personalSpends, 'others', isForOthers);
  parts.forEach((p) => { p.derived = round2(p.house + p.others); });
  return parts;
}

// The figure each month actually uses, and why it is that figure.
//
// Three rules, in order:
//   1. a figure the user TYPED wins - it is a correction, and a correction that
//      a recount quietly undid would be worthless;
//   2. otherwise a month with card spends logged against it uses their sum;
//   3. otherwise the stored figure stands. A month with nothing logged has
//      nothing to say about itself, and months from before the Tracker existed
//      carry hand-entered figures that are the only record there is.
export function _reimbMap(parts, reimbRows) {
  const stored = new Map((reimbRows || []).map((r) => [r.ym, r]));
  const map = {};
  const detail = new Map();
  new Set([...parts.keys(), ...stored.keys()]).forEach((ym) => {
    const p = parts.get(ym) || { house: 0, others: 0, derived: 0 };
    const row = stored.get(ym) || null;
    const manual = !!(row && row.manual);
    const auto = !manual && p.derived > 0;
    const amount = auto ? p.derived : round2(Number(row && row.amount) || 0);
    map[ym] = amount;
    detail.set(ym, { house: p.house, others: p.others, derived: p.derived, amount, auto, manual });
  });
  return { map, detail };
}

// What has actually been SETTLED in each statement month: the bills marked
// paid. Money that has left the account, which is why the monthly sheet
// subtracts it - and it is read off the cards rather than stored a second
// time, so unmarking a bill takes it straight back off.
function _ccPaidByYm(cards) {
  const out = {};
  (cards || []).forEach((c) => (c.months || []).forEach((r) => {
    const ym = String((r && r.ym) || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (r.status !== 'ontime' && r.status !== 'late') return;
    out[ym] = round2((out[ym] || 0) + (Number(r.billed) || 0));
  }));
  return out;
}

// Both readers - the Credit Card tab and the monthly sheet's Next Month Due -
// go through here, so the two can never disagree about the same month.
async function ccReimbursements() {
  const mod = await import('./credit.js');
  const [cards, rows, house, personal] = await Promise.all([
    DB.all('creditCards').catch(() => []),
    DB.all('ccReimbursements').catch(() => []),
    DB.all('spends').catch(() => []),
    DB.all('personalSpends').catch(() => []),
  ]);
  return Object.assign(_reimbMap(_reimbParts(cards, house, personal, mod), rows),
    { paid: _ccPaidByYm(cards) });
}

// What this month's spending says when read against the months before it.
// Returns only the observations that actually have data behind them — an
// insight panel that pads itself out with "no change" lines stops being read.
//
// Deliberately plain arithmetic on months already in memory: no projection
// models, no thresholds tuned to one household. Each line states a number the
// user could verify by hand, which is the only kind worth trusting here.
function _trackerInsights(ym, timelineYms, byYm, byCat, spent, totalOf) {
  const out = [];
  const fmtDelta = (n) => (n >= 0 ? '+' : '−') + fmtSheetCur(Math.abs(n)).replace('₹', '₹');
  const monLabel = (k) => {
    const m = /^(\d{4})-(\d{2})/.exec(k || '');
    return m ? _SPEND_MONS[+m[2] - 1] : k;
  };

  // Calendar previous month, whether or not it has entries — "nothing last
  // month" is itself worth knowing, so it isn't skipped over silently.
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYm = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const prevTotal = totalOf(prevYm);
  const prevRows = byYm.get(prevYm) || [];

  // ---- 1. Against last month ----
  if (prevTotal > 0) {
    const diff = round2(spent - prevTotal);
    const pct = Math.abs(Math.round((diff / prevTotal) * 100));
    out.push({
      icon: diff > 0 ? '📈' : diff < 0 ? '📉' : '➖',
      tone: diff > 0 ? 'warn' : diff < 0 ? 'good' : '',
      head: diff === 0
        ? 'Same as ' + monLabel(prevYm)
        : fmtDelta(diff) + ' vs ' + monLabel(prevYm) + ' (' + pct + '%)',
      sub: monLabel(prevYm) + ' came to ' + fmtSheetCur(prevTotal) + '; this month is ' + fmtSheetCur(spent) + '.',
    });
  }

  // ---- 2. Against the running average of earlier months ----
  const earlier = timelineYms.filter((k) => k < ym).map((k) => totalOf(k)).filter((t) => t > 0);
  if (earlier.length >= 2) {
    const avg = round2(earlier.reduce((s, t) => s + t, 0) / earlier.length);
    const diff = round2(spent - avg);
    out.push({
      icon: '⚖️',
      tone: diff > 0 ? 'warn' : 'good',
      head: fmtDelta(diff) + ' vs your ' + earlier.length + '-month average',
      sub: 'You normally spend about ' + fmtSheetCur(avg) + ' a month.',
    });
  }

  // ---- 3. Categories that moved most against last month ----
  if (prevRows.length) {
    const prevCat = new Map();
    prevRows.forEach((r) => {
      const k = r.category || 'Prev Bill Bal / Misc';
      prevCat.set(k, round2((prevCat.get(k) || 0) + (Number(r.amount) || 0)));
    });
    const names = new Set([...byCat.keys(), ...prevCat.keys()]);
    const moves = [...names].map((n) => ({
      name: n,
      now: (byCat.get(n) || { total: 0 }).total,
      was: prevCat.get(n) || 0,
    })).map((m) => Object.assign(m, { diff: round2(m.now - m.was) }));

    const up = moves.filter((m) => m.diff > 0).sort((a, b2) => b2.diff - a.diff)[0];
    const down = moves.filter((m) => m.diff < 0).sort((a, b2) => a.diff - b2.diff)[0];
    if (up) {
      out.push({
        icon: '🔺', tone: 'warn',
        head: up.name + ' up ' + fmtSheetCur(up.diff),
        sub: fmtSheetCur(up.was) + ' in ' + monLabel(prevYm) + ' → ' + fmtSheetCur(up.now) + ' now.',
      });
    }
    if (down) {
      out.push({
        icon: '🔻', tone: 'good',
        head: down.name + ' down ' + fmtSheetCur(Math.abs(down.diff)),
        sub: fmtSheetCur(down.was) + ' in ' + monLabel(prevYm) + ' → ' + fmtSheetCur(down.now) + ' now.',
      });
    }
    // Something being spent on for the first time is worth surfacing on its
    // own — it won't top the "moved most" list while it's still small.
    const fresh = moves.filter((m) => m.was === 0 && m.now > 0).sort((a, b2) => b2.now - a.now)[0];
    if (fresh && (!up || fresh.name !== up.name)) {
      out.push({
        icon: '🆕', tone: '',
        head: 'New this month: ' + fresh.name,
        sub: fmtSheetCur(fresh.now) + ', with nothing in ' + monLabel(prevYm) + '.',
      });
    }
  }

  // ---- 4. Where the money actually goes ----
  //
  // Against the gross, not against `spent`, which is net of refunds - the
  // roll-up above this panel measures shares the same way, and one page
  // calling the same category 49% in one place and 54% in another is a page
  // nobody trusts twice.
  const grossOut = round2([...byCat.values()].reduce((a, c) => a + Math.max(0, c.total), 0));
  const top = [...byCat.entries()].sort((a, b2) => b2[1].total - a[1].total)[0];
  if (top && grossOut > 0 && top[1].total > 0) {
    const pct = Math.round((top[1].total / grossOut) * 100);
    if (pct >= 30) {
      out.push({
        icon: '🎯', tone: '',
        head: top[0] + ' is ' + pct + '% of the month',
        sub: fmtSheetCur(top[1].total) + ' of ' + fmtSheetCur(grossOut) + ' went there.',
      });
    }
  }

  return out;
}

// "12 Sep" — short, since the rows already sit under one month.
export const _SPEND_MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function _spendDayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? String(+m[3]) + ' ' + _SPEND_MONS[+m[2] - 1] : '—';
}

// Opens the spend form from the FAB, wherever that FAB happens to be. Works out
// the kitty itself rather than being handed it, since on Home there is no
// tracker render to pass it in. Uses the month the Tracker is showing when
// that's where we are, and this month everywhere else.
export async function openSpendQuick() {
  const now = new Date();
  // Tracker only. Review is pinned to this month now, so taking _trkYm there
  // would date a spend into whatever month the Tracker was last left on.
  const onMonthTab = state.appMode === 'expense' && ui._expTab === 'tracker' && ui._trkYm;
  const ym = onMonthTab ? ui._trkYm : (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
  const [allocs, efLoans] = await Promise.all([
    DB.all('allocations').catch(() => []),
    DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
  ]);
  // Dates default INTO the month being viewed. Back-filling an old month and
  // having every entry land on today would file them all under the wrong
  // month — and silently, since the form would look right while saving wrong.
  // Today's date for the current month; the 1st for any earlier one, as a
  // clearly provisional day to correct rather than a guess at the real one.
  const today = todayISO();
  const defaultDate = ym === today.slice(0, 7) ? today : ym + '-01';
  openSpendForm(_kittyFor(ym, allocs, efLoans), null, defaultDate);
}

// Add one spend: category, amount, how it was paid. Deliberately that short —
// this gets opened several times a day, and anything longer stops being used.
// ---------- Splitting the milk out of a shop run ----------
//
// The Brigade run and the local shop are one payment but two kinds of spend:
// the groceries, and the milk that goes on the same bill every time. Logged as
// a single line the milk disappears inside "Brigade", and its own month-on-month
// trend - the one thing about it actually worth watching - can never be read
// back out.
//
// So the form offers to split it at the point of entry, while the number is
// still in front of you, rather than asking for two entries every time or for a
// correction afterwards. One payment becomes two rows that share a date, a
// method and a card, and add back up to what was really paid.
//
// Offered on a NEW entry only. Afterwards there are two ordinary rows to edit
// directly, and re-splitting an already-split row is a good way to end up with
// three.
const MILK_SPLIT_FROM = ['Brigade', 'Local Shop'];
const MILK_CAT = 'Milk';
// Categories are the user's to rename and delete, so the offer is only made
// when there is somewhere for the milk to go.
const milkSplitAvailable = () => catList('spend').some((g) => (g.items || []).indexOf(MILK_CAT) >= 0);

async function openSpendForm(budget, existing, defaultDate) {
  const editing = !!(existing && existing.id != null);
  let chosenCat = editing ? existing.category : null;
  let chosenMethod = editing ? (existing.method || 'UPI') : 'UPI';
  let chosenCardId = editing ? (existing.cardId != null ? existing.cardId : null) : null;

  const cards = (await DB.all('creditCards').catch(() => [])) || [];
  const amount = el('input', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: '0', value: editing ? existing.amount : '' });
  const dateInp = el('input', { type: 'date', value: editing ? (existing.date || todayISO()) : (defaultDate || todayISO()) });
  // Tags in place of a note. The suggestions come from every household spend
  // already logged, which is what makes the same word get reused instead of
  // retyped four ways.
  const allSpendRows = (await DB.all('spends').catch(() => [])) || [];
  const tagBox = tagField(editing ? existing.tags : [], knownTags(allSpendRows), 'Tags');

  const catBtns = [];
  const reopen = () => openSpendForm(budget, existing, defaultDate);
  const catGrid = el('div', {}, catList('spend').map((g) => el('div', { class: 'spend-cat-group' }, [
    el('div', { class: 'spend-cat-group-label' }, [
      el('span', { text: g.group }),
      catAddBtn('Add a sub-category under ' + g.group, () => openCatManager('spend', g.group, reopen)),
    ]),
    el('div', { class: 'spend-cat-grid' }, g.items.map((name) => {
      const btn = el('button', {
        class: 'spend-cat-btn' + (name === chosenCat ? ' active' : '')
          + (name === REFUND_CAT ? ' is-refund' : ''),
        type: 'button', text: name,
      });
      btn.addEventListener('click', () => {
        chosenCat = name;
        catBtns.forEach((x) => x.classList.toggle('active', x === btn));
        syncMilk();
        syncRefund();
        amount.focus();
      });
      catBtns.push(btn);
      return btn;
    })),
  ])));

  // Money coming back off the kitty, the same way it works on the personal
  // side: the amount is typed as a positive figure and stored negative, so
  // every total that already sums these rows - the month, the per-day figure,
  // what a card owes back - simply comes down by it.
  const amountField = field('Amount (\u20b9)', amount);
  const amountLabel = amountField.querySelector('label span') || amountField.querySelector('label');
  const refundNote = el('p', { class: 'hint pf-refund-note hidden',
    text: 'Money coming back into the household budget. Enter it as a positive figure — it comes off the '
      + 'month’s spending, off what is left to spend, and off the card it was credited to.' });
  const syncRefund = () => {
    const on = chosenCat === REFUND_CAT;
    if (amountLabel) amountLabel.textContent = on ? 'Refunded (\u20b9)' : 'Amount (\u20b9)';
    amountField.classList.toggle('is-refund', on);
    refundNote.classList.toggle('hidden', !on);
  };

  const milkChk = el('input', { type: 'checkbox' });
  const milkAmt = el('input', {
    type: 'number', inputmode: 'decimal', step: 'any', class: 'milk-amt',
    placeholder: '0', 'aria-label': 'Milk amount',
  });
  const milkAmtWrap = el('div', { class: 'milk-amt-wrap hidden' }, [
    el('span', { class: 'milk-amt-cur', text: '₹' }), milkAmt,
  ]);
  const milkNote = el('p', { class: 'hint milk-note hidden' });
  // The switch has to be the .switch element itself: .switch-track is
  // position:absolute;inset:0, so without that positioned parent it stretches
  // over whatever ancestor is positioned instead - which, in a modal, is the
  // whole sheet.
  const milkBox = el('div', { class: 'field milk-split hidden' }, [
    el('div', { class: 'milk-row' }, [
      el('label', { class: 'switch switch-sm' }, [
        milkChk,
        el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
      ]),
      el('span', { class: 'milk-lbl', text: 'Milk on this bill' }),
      milkAmtWrap,
    ]),
    milkNote,
  ]);
  // What the split will actually record, worked out live - the two figures are
  // the whole point, and a checkbox that only says what it does after you save
  // it is a checkbox nobody trusts.
  const syncMilkNote = () => {
    const total = round2(num(amount.value) || 0);
    const milk = round2(num(milkAmt.value) || 0);
    const on = milkChk.checked;
    milkNote.classList.toggle('hidden', !on);
    if (!on) return;
    if (!(total > 0)) { milkNote.textContent = 'Enter the bill total above first.'; return; }
    if (!(milk > 0)) { milkNote.textContent = 'How much of the ' + fmtSheetCur(total) + ' was milk?'; return; }
    if (milk >= total) {
      milkNote.textContent = 'That is the whole bill \u2014 pick Milk as the category instead.';
      return;
    }
    milkNote.textContent = fmtSheetCur(round2(total - milk)) + ' to ' + (chosenCat || 'the shop')
      + ' · ' + fmtSheetCur(milk) + ' to ' + MILK_CAT + ', tagged “' + normaliseTag(chosenCat || '')
      + '” · same date and payment.';
  };
  const syncMilk = () => {
    const offer = !editing && chosenCat !== REFUND_CAT
      && milkSplitAvailable() && MILK_SPLIT_FROM.indexOf(chosenCat) >= 0;
    milkBox.classList.toggle('hidden', !offer);
    if (!offer) { milkChk.checked = false; milkAmt.value = ''; }
    milkAmtWrap.classList.toggle('hidden', !milkChk.checked);
    syncMilkNote();
  };
  milkChk.addEventListener('change', () => {
    milkAmtWrap.classList.toggle('hidden', !milkChk.checked);
    syncMilkNote();
    if (milkChk.checked) milkAmt.focus();
  });
  milkAmt.addEventListener('input', syncMilkNote);
  amount.addEventListener('input', syncMilkNote);

  // Which card the swipe went on — only asked once "Card" is the method, since
  // it's meaningless otherwise. Choosing one adds the spend to that month's
  // card reimbursement on the Credit Card tab, so what gets credited back
  // accumulates as the month goes instead of being totted up at the end of it.
  const cardBtns = [];
  const cardGrid = el('div', { class: 'spend-card-grid' }, cards.map((c) => {
    const btn = el('button', { class: 'spend-card-btn' + (c.id === chosenCardId ? ' active' : ''), type: 'button' }, [
      el('span', { class: 'spend-card-radio' }),
      el('span', { class: 'spend-card-name', text: c.name || 'Card' }),
    ]);
    btn.addEventListener('click', () => {
      chosenCardId = chosenCardId === c.id ? null : c.id; // tap again to unset
      cardBtns.forEach((x) => x.classList.toggle('active', x === btn && chosenCardId === c.id));
    });
    cardBtns.push(btn);
    return btn;
  }));
  // Says so when the card WON'T be billed, rather than quietly not doing it:
  // the picker still records which card paid, but an earlier month's statement
  // is closed and isn't rewritten. Follows the date field, since changing the
  // date is what moves a spend out of the current month.
  const pastNote = el('p', { class: 'hint spend-card-note', style: 'margin:6px 0 0' });
  const syncPastNote = () => {
    const d = (dateInp.value || todayISO()).slice(0, 7);
    const past = d !== _thisSpendYm();
    pastNote.textContent = past
      ? 'Recorded against the card, but ' + _spendMonthLabel(d) + ' is a closed month — its reimbursement is left as it is.'
      : '';
    pastNote.classList.toggle('hidden', !past);
  };
  dateInp.addEventListener('change', syncPastNote);

  const cardField = field('Which card', cards.length
    ? el('div', {}, [cardGrid, pastNote])
    : el('p', { class: 'hint', style: 'margin:0', text: 'No credit cards yet — add one on the Credit Card tab to bill spends to it.' }));
  cardField.classList.toggle('hidden', chosenMethod !== 'Card');
  syncPastNote();

  const methodBtns = [];
  const methodRow = el('div', { class: 'seg spend-method' }, SPEND_METHODS.map((m) => {
    const btn = el('button', { type: 'button', class: m === chosenMethod ? 'active' : '', text: m });
    btn.addEventListener('click', () => {
      chosenMethod = m;
      methodBtns.forEach((x) => x.classList.toggle('active', x === btn));
      cardField.classList.toggle('hidden', m !== 'Card');
      // Switching away from Card drops the selection, so a card can't be
      // silently billed for something paid by UPI.
      if (m !== 'Card') { chosenCardId = null; cardBtns.forEach((x) => x.classList.remove('active')); }
    });
    methodBtns.push(btn);
    return btn;
  }));

  const save = async () => {
    if (!chosenCat) { toast('Pick a category'); return; }
    // Typed as a positive figure either way; the sign goes on here, once, and
    // every sum downstream is then simply right - see REFUND_CAT.
    const typed = round2(Math.abs(num(amount.value) || 0));
    if (!(typed > 0)) { toast('Enter an amount'); return; }
    const amt = chosenCat === REFUND_CAT ? -typed : typed;
    const nowIso = new Date().toISOString();
    // Filed under the month of the DATE CHOSEN, not today's — logging
    // yesterday's spend just after midnight must not land it in the wrong month.
    const d = (dateInp.value || todayISO()).slice(0, 10);
    const ym = d.slice(0, 7);
    const cardId = chosenMethod === 'Card' ? chosenCardId : null;
    // Nothing to unwind on an edit: the reimbursement is recounted from the
    // entries every time it is read, so changing the amount, the card, the
    // month or the method is already accounted for the moment this saves.
    const rec = {
      ym, date: d, category: chosenCat, amount: amt,
      method: chosenMethod, cardId, tags: tagBox.get(),
      // A note written before tags existed is kept, not quietly dropped. It
      // still shows on the row; there is just no longer a box to write a new
      // one in.
      note: editing && existing.note ? existing.note : null,
      createdAt: editing ? (existing.createdAt || nowIso) : nowIso, updatedAt: nowIso,
    };
    // The milk comes OFF the amount typed, because what was typed is the bill:
    // adding it on top instead would record more than was actually paid.
    const milkOn = !milkBox.classList.contains('hidden') && milkChk.checked;
    const milkVal = milkOn ? round2(num(milkAmt.value) || 0) : 0;
    if (milkOn) {
      if (!(milkVal > 0)) { toast('Enter the milk amount'); return; }
      if (milkVal >= typed) {
        toast('Milk is the whole ' + fmtSheetCur(typed) + ' · pick Milk as the category instead');
        return;
      }
    }
    rec.amount = round2(amt - milkVal);

    if (editing) rec.id = existing.id;
    await DB.put('spends', rec);
    if (milkOn) {
      // Same trip, same payment: everything is carried over but the category
      // and the figure. No id - this is a second row, never an overwrite.
      //
      // Plus a tag naming where it was bought. Without it the milk row is
      // stranded from the trip it came off, and "was the Brigade milk dearer
      // than the local shop's" - the question the split exists to make
      // askable - stays unanswerable. It goes FIRST so that a trip already
      // carrying the maximum number of tags loses one of those to the cap
      // rather than losing this one.
      const milkTags = tagsOf({ tags: [normaliseTag(chosenCat)].concat(rec.tags || []) });
      const milkRec = Object.assign({}, rec, {
        category: MILK_CAT, amount: milkVal, tags: milkTags, createdAt: nowIso,
      });
      delete milkRec.id;
      await DB.put('spends', milkRec);
    }
    closeModal();
    toast((editing ? 'Updated ' : 'Added ') + fmtSigned(rec.amount)
      + (milkOn ? ' · ' + fmtSheetCur(milkVal) + ' to ' + MILK_CAT : '')
      + (chosenMethod === 'Card' ? ' · on the card reimbursement' : ''));
    renderHomeExpense();
  };

  syncMilk();
  syncRefund();

  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: editing ? 'Edit spend' : 'Add spend' }),
      el('p', { class: 'hint', text: budget > 0 ? 'Comes off the ' + fmtSheetCur(budget) + ' household household budget.' : 'No House Exp allocation set yet — this is still logged.' }),
      el('div', { class: 'field' }, [
        el('label', {}, [
          el('span', { text: 'Category' }),
          catAddBtn('Add a category', () => openCatManager('spend', null, reopen)),
        ]),
        catGrid,
      ]),
      el('div', { class: 'field-row' }, [amountField, field('Date', dateInp)]),
      refundNote,
      milkBox,
      field('Paid by', methodRow),
      cardField,
      tagBox.node,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ])]),
  ]));
}

// Swipe left/right to step a month, matching the Credit Card tab (left goes
// forward in time). Attached to a whole tab body, but a gesture starting inside
// the month strip is ignored: that strip scrolls horizontally, so a swipe there
// is the user scrolling it, not asking to change month.
//
// The move must also be mostly horizontal. Without that, a diagonal flick while
// scrolling the page changes month underneath you, which reads as the app
// losing your place.
// ---------- Month-timeline scroll behaviour (shared) ----------
// Every month strip in the Expense section - Credit Card, Tracker, Review - is
// rebuilt from scratch on each render, which means its scroll container is new
// and its scrollLeft starts at 0. Centring the selected chip from there made a
// click on "three months back" animate all the way from the FIRST month, and a
// re-render for any other reason (saving a spend, switching the inner view)
// threw away wherever the strip had been scrolled to.
//
// So the offset is remembered per strip and restored before anything is
// animated: a pick then slides only the remaining distance, and a plain
// re-render leaves the strip exactly where it was.
const _monthStripScroll = new Map();

// Mounts a month strip. `key` names the strip (its own scroll memory), `wrap`
// is the overflow container, `animate` says the user just picked a month, so
// the move to centre is worth showing.
export function _mountMonthStrip(key, wrap, animate) {
  const saved = _monthStripScroll.get(key);
  const hadSaved = saved != null && saved > 0;
  if (hadSaved) wrap.scrollLeft = saved;
  // Manual scrolling is what most of these offsets come from.
  wrap.addEventListener('scroll', () => { _monthStripScroll.set(key, wrap.scrollLeft); }, { passive: true });

  // Centring needs real geometry, and the strip has none until it is laid out.
  // One frame is enough, and it is after the restore above, so nothing is ever
  // seen at 0.
  requestAnimationFrame(() => {
    if (!wrap.isConnected) return;
    const chip = wrap.querySelector('.cc-timeline-chip.active');
    if (!chip) return;
    const view = wrap.clientWidth;
    const max = Math.max(0, wrap.scrollWidth - view);
    const centre = Math.max(0, Math.min(max, chip.offsetLeft - (view - chip.offsetWidth) / 2));
    // On a plain re-render the user's own scroll position wins - unless the
    // selected month has been left off-screen by it, which would hide the one
    // chip the rest of the page is about.
    if (!animate && hadSaved) {
      const l = chip.offsetLeft - wrap.scrollLeft;
      if (l >= 0 && l + chip.offsetWidth <= view) return;
    }
    if (Math.abs(centre - wrap.scrollLeft) < 2) return;
    // scrollTo on the strip, not scrollIntoView on the chip: these strips are
    // sticky, and scrollIntoView walks up the ancestors and moves the PAGE's
    // scroll too.
    _monthStripScroll.set(key, centre);
    if (animate && typeof wrap.scrollTo === 'function') wrap.scrollTo({ left: centre, behavior: 'smooth' });
    else wrap.scrollLeft = centre;
  });
}

// A drag that starts inside something that scrolls SIDEWAYS belongs to that
// strip, not to the month. The month timeline was the first of these; the
// entries filter is the second, and scrolling its chips was moving the month
// instead of the chips.
//
// Two tests rather than a list of class names. The computed one covers any
// strip added later without having to remember this function exists; the named
// one covers a strip that happens not to overflow right now - a timeline of
// three chips still owns its own gestures, because whether it scrolls today
// depends on how many months are on record.
const SWIPE_OWN_STRIPS = '.cc-timeline-scroll, .pf-filter';
function _ownsHorizontalDrag(target, stopAt) {
  if (target && target.closest && target.closest(SWIPE_OWN_STRIPS)) return true;
  for (let n = target; n && n !== stopAt; n = n.parentElement) {
    if (n.nodeType !== 1) continue;
    if (n.scrollWidth - n.clientWidth > 4) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function _attachMonthSwipe(node, months, curYm, pick) {
  let x0 = 0, y0 = 0, startedIn = null;
  const THRESHOLD = 50;
  node.addEventListener('touchstart', (e) => {
    startedIn = e.target;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  node.addEventListener('touchend', (e) => {
    if (_ownsHorizontalDrag(startedIn, node)) return;
    const dx = x0 - e.changedTouches[0].clientX;
    const dy = y0 - e.changedTouches[0].clientY;
    if (Math.abs(dx) < THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const next = months[months.indexOf(curYm) + (dx > 0 ? 1 : -1)];
    if (next) pick(next);
  }, { passive: true });
}

// Is the kitty itself the problem? Being over most months is not a discipline
// finding, it is a budget finding — and answering "spend less" to a household
// whose allocation was never realistic is the wrong advice. Completed months
// only: the current one is part-way through and would drag every figure down.
//
// `kittyOf` is passed in because the House Exp allocation is per YEAR, so a
// window spanning a year boundary has two different kitties in it.
export function _reviewKittyFit(ym, byYm, kittyOf, thisYm) {
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // Every month on record that had spending and a budget behind it - no window.
  // This is a month-TOTAL question, so it is not day-floored, and it does not
  // age out either: each month is judged against the kitty that applied in that
  // month (kittyOf(k), not today's), so an older month is compared fairly
  // rather than against a figure it never had. More months simply means a
  // better-founded answer, and the count is printed so the reader can see how
  // much is behind it.
  const months = [...byYm.keys()]
    .filter((k) => k < thisYm && totalOf(k) > 0 && kittyOf(k) > 0)
    .sort();
  if (months.length < 3) return null;

  const rows = months.map((k) => ({ ym: k, total: totalOf(k), kitty: kittyOf(k) }));
  const over = rows.filter((r) => r.total > r.kitty);
  const totals = rows.map((r) => r.total);
  const leanest = rows.reduce((a, b) => (b.total < a.total ? b : a));
  const heaviest = rows.reduce((a, b) => (b.total > a.total ? b : a));

  // What kitty would have covered all but the single worst month. Taking the
  // very highest would size the budget to one outlier; the second-highest
  // covers the realistic range. Rounded up to a round number, because nobody
  // sets an allocation to ₹24,317.
  const sorted = totals.slice().sort((a, b) => b - a);
  const target = sorted.length > 1 ? sorted[1] : sorted[0];
  const suggested = Math.ceil(target / 500) * 500;
  const covered = rows.filter((r) => r.total <= suggested).length;
  const currentKitty = kittyOf(ym);

  return {
    months: rows.length, overCount: over.length,
    avgOvershoot: over.length ? round2(over.reduce((s, r) => s + (r.total - r.kitty), 0) / over.length) : 0,
    leanest, heaviest, suggested, covered, currentKitty,
    // Only worth suggesting a change if it is both higher than what is set and
    // would actually have covered more months than the present figure did.
    coveredNow: rows.filter((r) => r.total <= currentKitty).length,
  };
}

// Where a month bleeds out in small pieces. Nothing else in the app looks at
// individual entries — every other view sums them — and a month is often lost
// to forty small taps rather than one big one.
const SMALL_TICKET = 200;
// ---------- Where the DAY inside a month can be trusted ----------
//
// Two different questions are asked of history on the Review tabs, and the same
// months are not equally good at answering both.
//
//   WHAT was spent, by category, month by month - "how much on food in March" -
//   is sound all the way back. Those months were entered from records that had
//   the totals right.
//
//   WHEN inside the month it was spent - which day, how many separate
//   payments, weekday or weekend - is not. Older months were reconstructed
//   afterwards: the category totals were known, the individual dates were not,
//   so entries carry a date that was near enough for the month and no better
//   than that.
//
// Reading a day-of-month pattern out of dates that were never observed would
// invent a spending habit and then advise against it. So anything that looks
// INSIDE a month is floored at the month real day-by-day logging began, while
// the category comparisons keep the full history.
//
// One line to move if the floor ever changes; nothing else needs touching.
const DAY_DETAIL_FROM_YM = '2026-09';
const dayDetailOk = (ym) => String(ym || '') >= DAY_DETAIL_FROM_YM;

export function _reviewSmallTickets(ym, byYm) {
  const rows = byYm.get(ym) || [];
  if (!rows.length) return null;
  const small = rows.filter((r) => (Number(r.amount) || 0) > 0 && (Number(r.amount) || 0) <= SMALL_TICKET);
  // Under five of them there is no pattern to report, just a few small buys.
  if (small.length < 5) return null;
  const monthTotal = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const smallTotal = round2(small.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const byCat = new Map();
  small.forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    const e = byCat.get(n) || { count: 0, total: 0 };
    e.count++; e.total = round2(e.total + (Number(r.amount) || 0));
    byCat.set(n, e);
  });
  return {
    threshold: SMALL_TICKET,
    count: small.length, total: smallTotal,
    entryShare: Math.round((small.length / rows.length) * 100),
    valueShare: monthTotal > 0 ? Math.round((smallTotal / monthTotal) * 100) : 0,
    top: [...byCat.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3)
      .map(([name, e]) => ({ name, count: e.count, total: e.total })),
  };
}

// Categories rising every month for several months running. The median check
// on the main list misses these by design: drift that never spikes stays close
// to its own median while quietly doubling over half a year.
const CREEP_MIN_RUN = 3;   // months, including the selected one
export function _reviewCreeping(ym, byYm, groupOf) {
  const grp = groupOf || _spendGroupOf;
  const months = [...byYm.keys()].filter((k) => k <= ym).sort();
  if (months.length < CREEP_MIN_RUN) return [];
  const perMonth = months.map((k) => {
    const m = new Map();
    (byYm.get(k) || []).forEach((r) => {
      const n = r.category || 'Prev Bill Bal / Misc';
      m.set(n, round2((m.get(n) || 0) + (Number(r.amount) || 0)));
    });
    return { ym: k, cats: m };
  });
  const last = perMonth[perMonth.length - 1];
  if (last.ym !== ym) return [];

  const out = [];
  last.cats.forEach((_, name) => {
    // Walk backwards while each month is strictly lower than the one after it.
    // A gap month (category absent) ends the run rather than counting as zero:
    // "absent" usually means not bought, not bought-for-nothing, and treating
    // it as a rise from zero would call every reappearance a trend.
    const run = [];
    for (let i = perMonth.length - 1; i >= 0; i--) {
      const v = perMonth[i].cats.get(name);
      if (v == null) break;
      if (run.length && v >= run[run.length - 1].amount) break;
      run.push({ ym: perMonth[i].ym, amount: v });
    }
    if (run.length < CREEP_MIN_RUN) return;
    const seq = run.slice().reverse();
    const from = seq[0].amount, to = seq[seq.length - 1].amount;
    out.push({
      name, group: grp(name), seq,
      rise: round2(to - from),
      risePct: from > 0 ? Math.round(((to - from) / from) * 100) : null,
      months: seq.length,
      fixed: _reviewIgnores(name),
    });
  });
  return out.sort((a, b) => b.rise - a.rise);
}

// Card vs UPI vs Cash. The card share matters beyond curiosity: it is the part
// that lands on a statement later and feeds the month's reimbursement, so a
// month that felt cheap can still be building a bill.
export function _reviewMethods(ym, byYm, prevYm) {
  const tally = (k) => {
    const m = { UPI: 0, Card: 0, Cash: 0 };
    let total = 0;
    (byYm.get(k) || []).forEach((r) => {
      const a = Number(r.amount) || 0;
      const meth = m[r.method] != null ? r.method : 'UPI';
      m[meth] = round2(m[meth] + a);
      total = round2(total + a);
    });
    return { m, total };
  };
  const cur = tally(ym);
  if (!cur.total) return null;
  const prev = tally(prevYm);
  const share = (v, t) => (t > 0 ? Math.round((v / t) * 100) : 0);
  return {
    rows: ['Card', 'UPI', 'Cash']
      .map((k) => ({ method: k, amount: cur.m[k], share: share(cur.m[k], cur.total) }))
      .filter((r) => r.amount > 0),
    cardAmount: cur.m.Card,
    cardShare: share(cur.m.Card, cur.total),
    // Only comparable when the previous month has something in it.
    prevCardShare: prev.total > 0 ? share(prev.m.Card, prev.total) : null,
  };
}

// ---------- Review (Expense → Review tab) ----------
// Where this month's spending is unusual FOR THIS HOUSEHOLD, and what pulling
// it back to normal would actually recover. Everything below is arithmetic on
// months already loaded — no projection of category spend, no score out of a
// hundred, nothing the user could not check by hand from the Tracker.
//
// A category is judged against its own MEDIAN month, not its mean: with a
// handful of months on record one holiday, one hospital trip or one deposit
// drags a mean far enough to make every other month look thrifty.

// The household kitty for one month: the Yearly plan tab's House Exp, PLUS what someone else
// contributes to the house (if the plan says so), PLUS any emergency draw taken from the
// Emergency Fund that month.
//
// An emergency draw is money that genuinely left the fund and became spendable
// that month, so a month that had one is not overspending its budget — it had
// a bigger budget. Without this, the month an emergency happened would be the
// month the Tracker and Review both shout loudest about, which is both wrong
// and the least useful moment to be shouted at.
//
// Only loanKind 'emergency' counts. A self loan is borrowing for something that
// could have waited, and a gift to family is money out of the household, not
// into its spending — neither should quietly raise the budget.
//
// `loans` is the raw `emergency` store rows of kind 'loan'; passing them in
// keeps this pure and lets each surface load them however it already loads.
function _emergencyDrawIn(ym, loans) {
  return round2((loans || []).reduce((s, l) => {
    if (l.kind !== 'loan' || l.loanKind !== 'emergency') return s;
    // 'balance' means the draw is left to reconcile against the fund's own
    // balance and must NOT also raise a month's spending budget, or the same
    // money would be counted in both places. Rows written before the choice
    // existed have no field and keep the behaviour they already had.
    if (l.applyTo === 'balance') return s;
    if (String(l.takenDate || '').slice(0, 7) !== ym) return s;
    return s + (Number(l.amount) || 0);
  }, 0));
}

// An emergency draw taken with "Monthly kitty" raises the month it arrived in,
// and its repayment schedule lowers the months it is paid back over. Both are
// derived from the loan record; nothing about the kitty is stored.
//
// The subtraction is only for what is still OUTSTANDING in that month. Once a
// repayment is actually recorded it becomes a Tracker entry under the loan's
// category, and that entry already consumes the month's budget — so leaving
// the earmark in place as well would charge the same rupee twice. Either way a
// month ends up down by its planned amount: as a smaller kitty before the
// repayment, as a logged spend after it.
function _loanPlannedFor(loan, ym) {
  return round2((loan.plan || []).reduce((s, p) => (String(p.ym) === ym ? s + (Number(p.amount) || 0) : s), 0));
}
function _loanRepaidIn(loan, ym) {
  return round2((loan.repayments || []).reduce((s, rp) => (String(rp.date || '').slice(0, 7) === ym ? s + (Number(rp.amount) || 0) : s), 0));
}
// What a month's kitty gives up to loans still being repaid.
function _repayEarmarkIn(ym, loans) {
  return round2((loans || []).reduce((s, l) => {
    if (l.kind !== 'loan' || l.loanKind !== 'emergency' || l.applyTo === 'balance') return s;
    const outstanding = _loanPlannedFor(l, ym) - _loanRepaidIn(l, ym);
    return s + Math.max(0, outstanding);
  }, 0));
}

// What someone else puts into the household each month, when the Yearly plan says the house is shared.
export function _sharedFor(ym, allocs) {
  const al = (allocs || []).find((x) => Number(x.year) === Number(String(ym).slice(0, 4)));
  return al && al.sharedOn ? round2(Math.max(0, Number(al.sharedAmount) || 0)) : 0;
}
export function _kittyFor(ym, allocs, loans) {
  const al = (allocs || []).find((x) => Number(x.year) === Number(String(ym).slice(0, 4)));
  const share = al ? Number(al.houseExp) || 0 : 0;
  // Floored at zero: a schedule bigger than the month's own budget would
  // otherwise produce a negative kitty, which reads as a bug rather than as
  // "everything this month is already committed".
  return Math.max(0, round2(share + _sharedFor(ym, allocs) + _emergencyDrawIn(ym, loans) - _repayEarmarkIn(ym, loans)));
}

// Categories where being "over" isn't a decision anyone can act on this month.
// The Fixed group is contractual; Medicine is not a lifestyle choice, and
// listing it under "spend less" would be both useless and crass.
// Rent and bills are contractual and Medicine is not a lifestyle choice, so
// neither is something "spend less" can address. A personal list has no Fixed
// group, so there only Medicine is held back.
const _reviewIgnores = (name, groupOf) => (groupOf || _spendGroupOf)(name) === 'Fixed' || name === 'Medicine';

// At least this many earlier months with entries before a category's median is
// worth quoting. Two is the floor at which a median means anything at all;
// below it the tab says so rather than inventing a baseline.
export const REVIEW_MIN_HISTORY = 2;

const _median = (nums) => {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? round2(a[mid]) : round2((a[mid - 1] + a[mid]) / 2);
};

// ---------- Forecasting the rest of a month ----------
//
// The obvious way to forecast a month is spent / days-so-far * days-in-month.
// It is also wrong in the way that matters most: household spending is not
// spread evenly across a month. Rent, EMIs and bills land in the first week,
// so on the 6th that formula projects a fortune, and by the 25th it quietly
// under-counts everything still to come. Both errors are large AND
// predictable, which is exactly what makes them removable.
//
// So this builds the estimate the other way round. What has already been spent
// is a FACT, not an estimate; only the remainder is estimated, and it is
// estimated from what the days after today's date actually cost in each
// earlier month, compared at the same day of the month. Rent that has already
// gone out on the 5th is therefore not counted again, and rent that has not
// gone out yet is.
//
// The median across those months is the central figure and their spread is the
// range, so one wild month widens the range instead of moving the answer.
const REVIEW_FORECAST_MIN = 2;   // earlier months needed before forecasting at all
const REVIEW_FORECAST_GOOD = 8;  // % median error at or under which the method is doing well
const REVIEW_FORECAST_FAIR = 18; // ...and under which it is still worth quoting

export const _daysInYm = (k) => new Date(Number(String(k).slice(0, 4)), Number(String(k).slice(5, 7)), 0).getDate();

// One month's spending by day-of-month. Indexed by day, so day 1 is at [1].
function _spendDayTotals(rows, dim) {
  const out = new Array(dim + 2).fill(0);
  (rows || []).forEach((r) => {
    const d = Number(String(r.date || '').slice(8, 10)) || 0;
    if (d >= 1 && d <= dim) out[d] = round2(out[d] + (Number(r.amount) || 0));
  });
  return out;
}

// For each earlier month: what it spent BY `day`, what it spent AFTER `day`,
// and what it came to. A month shorter than `day` has no remainder, which is
// correct rather than a gap - by that day of the month it was already over.
function _monthSplitsAt(yms, byYm, day) {
  return (yms || []).map((k) => {
    const dim = _daysInYm(k);
    const days = _spendDayTotals(byYm.get(k) || [], dim);
    let by = 0, rest = 0, total = 0;
    for (let d = 1; d <= dim; d++) {
      total = round2(total + days[d]);
      if (d <= day) by = round2(by + days[d]);
      else rest = round2(rest + days[d]);
    }
    return { ym: k, by, rest, total };
  }).filter((r) => r.total > 0);
}

// The estimator itself, deliberately factored out so the live forecast and its
// own backtest below run the identical code path. Anything else would make the
// reported accuracy a claim about a different method than the one on screen.
function _forecastFrom(targetYm, priorYms, byYm, day) {
  const dim = _daysInYm(targetYm);
  const cut = Math.min(day, dim);
  const days = _spendDayTotals(byYm.get(targetYm) || [], dim);
  let spent = 0;
  for (let d = 1; d <= cut; d++) spent = round2(spent + days[d]);
  // Already booked for days still to come - rare, but a spend can be entered
  // with a later date, and it must not drop out of the month.
  let loggedAfter = 0;
  for (let d = cut + 1; d <= dim; d++) loggedAfter = round2(loggedAfter + days[d]);
  const splits = _monthSplitsAt(priorYms, byYm, cut);
  if (splits.length < REVIEW_FORECAST_MIN) return null;
  const rests = splits.map((r) => r.rest).sort((x, y) => x - y);
  return {
    dim, day: cut, spent, splits, loggedAfter,
    rest: _median(rests),
    restLo: rests[0], restHi: rests[rests.length - 1],
    // What a usual month had spent by this same day - the honest pacing
    // comparison, and the one figure a naive average gets most wrong.
    usualByNow: _median(splits.map((r) => r.by)),
  };
}

// The live forecast, plus its measured track record.
//
// How well the method actually does is not a matter of opinion: run it against
// each earlier month at the same day of the month, using only the months
// before that one, and compare with what the month really came to. The median
// absolute error rides alongside the forecast, so the figure carries its own
// evidence instead of an assurance.
export function _reviewForecast(ym, byYm, nowDate, dueTotal, kitty) {
  const dim = _daysInYm(ym);
  const day = Math.min(nowDate.getDate(), dim);
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // Priced from what the SAME DAYS cost before, so only months whose days are
  // real can be priced from.
  const hist = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k) && totalOf(k) > 0).sort();
  const f = _forecastFrom(ym, hist, byYm, day);
  if (!f) return null;

  // Recurring items that have NOT landed yet are a floor under the remainder,
  // not an addition to it: the median already contains them for the months
  // they occurred in, so taking the larger of the two avoids counting the same
  // rent twice while still refusing to forecast below a bill known to be due.
  const due = round2(dueTotal || 0);
  const rest = Math.max(f.rest, due, f.loggedAfter);
  const forecast = round2(f.spent + rest);

  const back = [];
  hist.forEach((k, i) => {
    const priors = hist.slice(0, i);
    if (priors.length < REVIEW_FORECAST_MIN) return;
    const g = _forecastFrom(k, priors, byYm, day);
    const actual = totalOf(k);
    if (!g || !(actual > 0)) return;
    const est = round2(g.spent + g.rest);
    back.push({ ym: k, est, actual, errPct: round2((Math.abs(est - actual) / actual) * 100) });
  });
  const errPct = back.length ? _median(back.map((b) => b.errPct)) : null;
  const grade = errPct == null
    ? (hist.length >= 4 ? 'fair' : 'rough')
    : errPct <= REVIEW_FORECAST_GOOD ? 'good' : errPct <= REVIEW_FORECAST_FAIR ? 'fair' : 'rough';

  const daysLeft = dim - day;
  return {
    dim, day, daysLeft, months: hist.length,
    spent: f.spent, rest, due,
    restIsDueFloor: due > f.rest && due >= f.loggedAfter,
    loggedAfter: f.loggedAfter,
    forecast,
    // The range is the observed spread of remainders, never narrower than the
    // central figure it brackets.
    lo: round2(f.spent + Math.min(f.restLo, rest)),
    hi: round2(f.spent + Math.max(f.restHi, rest)),
    usualByNow: f.usualByNow,
    vsUsualByNow: round2(f.spent - f.usualByNow),
    restPerDay: daysLeft > 0 ? round2(rest / daysLeft) : null,
    // What is affordable per day from here to finish inside the kitty. Negative
    // is meaningful and is shown as such: the kitty is already gone.
    // Today included: what is left can still be spent today, unlike `rest`
    // above, which prices only the days after it.
    fitDays: daysLeft + 1,
    fitPerDay: kitty > 0 ? perDayAllowance(kitty - f.spent, daysLeft + 1) : null,
    overKitty: kitty > 0 ? round2(forecast - kitty) : null,
    backtests: back, errPct, grade,
  };
}

// ---------- The shape of a month ----------
//
// A total says how much; this says WHEN, which is the half that changes
// behaviour. Knowing that half of every month is gone by the 9th, or that a
// weekend day costs twice a weekday, is what makes an ordinary Saturday a
// decision rather than a surprise at month end.
//
// Read in thirds rather than per day: a household does not repeat the 14th, it
// repeats "early", "middle" and "late".
const CYCLE_MIN_MONTHS = 3;
const CYCLE_LOOKBACK = 12;
const _DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function _reviewCycle(ym, byYm, nowDate, isCurrent) {
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // The shape of a month IS the day question, so this is day-floored too - and
  // returns null rather than a shape drawn from dates nobody recorded.
  const hist = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k) && totalOf(k) > 0).sort().slice(-CYCLE_LOOKBACK);
  if (hist.length < CYCLE_MIN_MONTHS) return null;

  const thirds = [[], [], []];
  const halfDays = [], noSpend = [], wkEndPerDay = [], wkDayPerDay = [], wkEndShare = [];
  const dowAmt = new Array(7).fill(0), dowDays = new Array(7).fill(0);
  // Which categories make each third of the month heavy. Kept per month so the
  // figure quoted is a median month, like everything else on this tab, rather
  // than a total divided by however many months happen to be on record.
  const thirdCat = [new Map(), new Map(), new Map()];

  hist.forEach((k) => {
    const dim = _daysInYm(k);
    const y = Number(k.slice(0, 4)), mo = Number(k.slice(5, 7));
    const days = _spendDayTotals(byYm.get(k) || [], dim);
    const total = totalOf(k);
    const t = [0, 0, 0];
    const catPer = [new Map(), new Map(), new Map()];
    (byYm.get(k) || []).forEach((r) => {
      const d = Number(String(r.date || '').slice(8, 10)) || 0;
      if (d < 1 || d > dim) return;
      const i = d <= 10 ? 0 : d <= 20 ? 1 : 2;
      const n = r.category || 'Prev Bill Bal / Misc';
      catPer[i].set(n, round2((catPer[i].get(n) || 0) + (Number(r.amount) || 0)));
    });
    catPer.forEach((m, i) => m.forEach((v, n) => {
      if (!thirdCat[i].has(n)) thirdCat[i].set(n, []);
      thirdCat[i].get(n).push(v);
    }));
    let run = 0, half = null, zero = 0, we = 0, weD = 0, wd = 0, wdD = 0;
    for (let d = 1; d <= dim; d++) {
      const amt = days[d];
      run = round2(run + amt);
      if (half == null && total > 0 && run >= total / 2) half = d;
      if (amt <= 0) zero++;
      const dow = new Date(y, mo - 1, d).getDay();
      dowAmt[dow] = round2(dowAmt[dow] + amt); dowDays[dow]++;
      if (dow === 0 || dow === 6) { we = round2(we + amt); weD++; } else { wd = round2(wd + amt); wdD++; }
      t[d <= 10 ? 0 : d <= 20 ? 1 : 2] += amt;
    }
    if (total > 0) {
      t.forEach((v, i) => thirds[i].push(round2((v / total) * 100)));
      wkEndShare.push(round2((we / total) * 100));
    }
    if (half != null) halfDays.push(half);
    noSpend.push(zero);
    if (weD) wkEndPerDay.push(round2(we / weD));
    if (wdD) wkDayPerDay.push(round2(wd / wdD));
  });

  // This month against that shape. Only for the current month - a finished
  // month has no "so far".
  const dim = _daysInYm(ym);
  const day = isCurrent ? Math.min(nowDate.getDate(), dim) : dim;
  const nowDays = _spendDayTotals(byYm.get(ym) || [], dim);
  let noSpendSoFar = 0;
  for (let d = 1; d <= day; d++) if (nowDays[d] <= 0) noSpendSoFar++;

  const perDow = _DOW.map((name, i) => ({
    name, i, perDay: dowDays[i] ? round2(dowAmt[i] / dowDays[i]) : 0,
  }));
  const busiest = perDow.slice().sort((a, b) => b.perDay - a.perDay)[0];
  const quietest = perDow.slice().filter((r) => r.perDay > 0).sort((a, b) => a.perDay - b.perDay)[0] || null;

  const wePerDay = _median(wkEndPerDay), wdPerDay = _median(wkDayPerDay);
  return {
    months: hist.length,
    // Rounded to whole percent and normalised so the three read as one month
    // rather than summing to 99 or 101 through rounding.
    thirds: (() => {
      const raw = thirds.map((v) => _median(v));
      const sum = raw.reduce((a, b) => a + b, 0) || 1;
      const pct = raw.map((v) => Math.round((v / sum) * 100));
      pct[2] = Math.max(0, 100 - pct[0] - pct[1]);
      return pct;
    })(),
    halfBy: halfDays.length ? Math.round(_median(halfDays)) : null,
    noSpendTypical: Math.round(_median(noSpend)),
    noSpendSoFar, daysSoFar: day, dim,
    weekendPerDay: wePerDay, weekdayPerDay: wdPerDay,
    weekendGap: round2(wePerDay - wdPerDay),
    weekendShare: wkEndShare.length ? Math.round(_median(wkEndShare)) : null,
    busiest, quietest, perDow,
    // Top three categories in each third of a typical month.
    thirdTops: thirdCat.map((m) => [...m.entries()]
      .map(([name, vals]) => ({ name, amount: _median(vals) }))
      .filter((r) => r.amount > 0)
      .sort((x, y) => y.amount - x.amount)
      .slice(0, 3)),
  };
}

// Cumulative spend day by day: this month against a usual one. The chart drawn
// from this is the whole forecast in one picture - where the month has got to,
// where it normally would be by now, and where the two are heading.
//
// A history month shorter than this one simply plateaus at its own last day,
// which is what actually happened rather than a gap in the line.
export function _reviewCurve(ym, byYm, day) {
  const dim = _daysInYm(ym);
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  // A usual-month curve is cumulative BY DAY, so day-floored as well.
  const hist = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k) && totalOf(k) > 0).sort();
  if (!hist.length) return null;
  const histCum = hist.map((k) => {
    const hd = _daysInYm(k);
    const days = _spendDayTotals(byYm.get(k) || [], hd);
    const cum = [];
    let run = 0;
    for (let d = 1; d <= dim; d++) { run = round2(run + (d <= hd ? days[d] : 0)); cum[d] = run; }
    return cum;
  });
  const nowDays = _spendDayTotals(byYm.get(ym) || [], dim);
  const out = [];
  let run = 0;
  for (let d = 1; d <= dim; d++) {
    run = round2(run + nowDays[d]);
    out.push({ day: d, now: d <= day ? run : null, usual: _median(histCum.map((c) => c[d])) });
  }
  return out;
}

// One category's last few months, for the mini bars revealed when a row is
// tapped. The evidence behind "usually X a month", in the form where an eye
// can check it.
export function _catMonthHistory(name, ym, byYm, count) {
  const months = [...byYm.keys()].filter((k) => k <= ym).sort().slice(-(count || 6));
  return months.map((k) => ({
    ym: k, current: k === ym,
    amount: round2((byYm.get(k) || [])
      .filter((r) => (r.category || 'Prev Bill Bal / Misc') === name)
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
  }));
}

// A usual month's worth of small change, for comparison against this one.
export function _smallTicketUsual(ym, byYm) {
  // How many separate small payments a month usually holds. A month entered as
  // one lump per category has no small payments in it by construction, so a
  // reconstructed month would drag this figure to nothing.
  const vals = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k)).sort().slice(-CYCLE_LOOKBACK)
    .map((k) => round2((byYm.get(k) || [])
      .filter((r) => (Number(r.amount) || 0) > 0 && (Number(r.amount) || 0) <= SMALL_TICKET)
      .reduce((s, r) => s + (Number(r.amount) || 0), 0)))
    .filter((v) => v > 0);
  return vals.length >= REVIEW_FORECAST_MIN ? _median(vals) : null;
}

// ---------- Where the money could actually stay ----------
//
// Every line here is measured against something this household has ALREADY
// done in some earlier month, which is what separates a saving from a wish.
// Nothing is invented: a category's own median month, its own usual number of
// visits, its own weekday spending.
//
// These overlap on purpose and are NOT summed. The same 180 rupees can be a
// small spend, a Saturday and an over-median Snacks entry all at once; three
// ways of seeing one leak is useful, adding them up three times is not. The
// only figure quoted as a total is the category one, which cannot overlap
// itself.
export function _reviewSavings(a, cycle, small, smallUsual) {
  const out = [];
  a.actionable.forEach((r) => {
    const fewer = r.usualCount && r.count > r.usualCount ? r.count - r.usualCount : 0;
    out.push({
      name: r.name, group: r.group, save: r.over, kind: 'category',
      how: (r.driver === 'more often' && fewer)
        ? fewer + (fewer === 1 ? ' fewer time' : ' fewer times') + ' this month would do it'
        : 'back to its usual ' + fmtSheetCur(r.usual) + ' a month',
    });
  });
  if (small && smallUsual != null) {
    const excess = round2(small.total - smallUsual);
    if (excess > 0) out.push({
      name: 'Small spends under ' + fmtSheetCur(small.threshold), group: 'Other',
      save: excess, kind: 'small',
      how: small.count + ' of them so far, ' + fmtSheetCur(small.total) + ' in all \u00b7 a usual month runs ' + fmtSheetCur(smallUsual),
    });
  }
  if (cycle && cycle.weekendGap > 0 && cycle.weekendPerDay > 0) {
    out.push({
      name: 'Weekend days', group: 'Lifestyle', save: cycle.weekendGap, kind: 'weekend',
      how: 'weekends run ' + fmtIntCur(cycle.weekendPerDay) + ' a day against '
        + fmtIntCur(cycle.weekdayPerDay) + ' on weekdays \u2014 that is the gap for each one you keep quiet',
    });
  }
  out.sort((x, y) => y.save - x.save);
  return { rows: out.slice(0, 6) };
}

// Pure: (selected month, all months by ym, this month, kitty, clock) → findings.
export function _reviewAnalysis(ym, byYm, thisYm, kitty, nowDate, groupOf) {
  // Defaults to the household category list. Personal Finance passes its own,
  // which is the only part of this that differs between the two.
  const gOf = groupOf || _spendGroupOf;
  const year = Number(ym.slice(0, 4)), mon = Number(ym.slice(5, 7));
  const daysInMonth = new Date(year, mon, 0).getDate();
  const isCurrent = ym === thisYm;
  const daysElapsed = isCurrent ? Math.min(nowDate.getDate(), daysInMonth) : daysInMonth;
  const daysLeft = isCurrent ? daysInMonth - daysElapsed : 0;

  const rowsOf = (k) => byYm.get(k) || [];
  const totalOf = (k) => round2(rowsOf(k).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const spent = totalOf(ym);

  // Earlier months that actually have entries. Only these form a baseline —
  // a month with nothing logged is missing data, not a frugal month, and
  // averaging zeros in would understate every category's normal.
  const historyYms = [...byYm.keys()].filter((k) => k < ym && totalOf(k) > 0).sort();

  // This month, per category.
  const nowCat = new Map();
  rowsOf(ym).forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    const e = nowCat.get(n) || { total: 0, count: 0 };
    e.total = round2(e.total + (Number(r.amount) || 0));
    e.count++;
    nowCat.set(n, e);
  });

  // Every earlier month, per category, kept per-month so a median can be taken
  // across months rather than across individual entries.
  const histCat = new Map(); // name -> { totals: [], counts: [] }
  historyYms.forEach((k) => {
    const perCat = new Map();
    rowsOf(k).forEach((r) => {
      const n = r.category || 'Prev Bill Bal / Misc';
      const e = perCat.get(n) || { total: 0, count: 0 };
      e.total = round2(e.total + (Number(r.amount) || 0));
      e.count++;
      perCat.set(n, e);
    });
    perCat.forEach((v, n) => {
      if (!histCat.has(n)) histCat.set(n, { totals: [], counts: [] });
      histCat.get(n).totals.push(v.total);
      histCat.get(n).counts.push(v.count);
    });
  });

  const actionable = [], fixedRows = [], unjudged = [];
  nowCat.forEach((cur, name) => {
    if (_reviewIgnores(name, gOf)) { fixedRows.push({ name, now: cur.total }); return; }
    const h = histCat.get(name);
    if (!h || h.totals.length < REVIEW_MIN_HISTORY) {
      unjudged.push({ name, now: cur.total, months: h ? h.totals.length : 0 });
      return;
    }
    const usual = _median(h.totals);
    const over = round2(cur.total - usual);
    if (over <= 0) return; // at or under its own normal — nothing to say

    // More often, or dearer each time? The remedy differs, so it's only stated
    // when one clearly dominates; when the two move together it is left out
    // rather than picking a side on a rounding difference.
    const usualCount = Math.round(_median(h.counts)) || 0;
    const usualAvg = usualCount > 0 ? round2(usual / usualCount) : 0;
    const nowAvg = cur.count > 0 ? round2(cur.total / cur.count) : 0;
    const cRatio = usualCount > 0 ? cur.count / usualCount : 0;
    const aRatio = usualAvg > 0 ? nowAvg / usualAvg : 0;
    let driver = null;
    if (cRatio && aRatio && Math.abs(cRatio - aRatio) >= 0.15) {
      driver = cRatio > aRatio ? 'more often' : 'dearer each time';
    }
    actionable.push({
      name, group: gOf(name), now: cur.total, usual, over,
      count: cur.count, usualCount, nowAvg, usualAvg, driver,
      months: h.totals.length,
    });
  });

  actionable.sort((a, b) => b.over - a.over);
  fixedRows.sort((a, b) => b.now - a.now);
  unjudged.sort((a, b) => b.now - a.now);

  return {
    ym, isCurrent, daysInMonth, daysElapsed, daysLeft,
    spent, kitty, overKitty: round2(spent - kitty),
    historyMonths: historyYms.length,
    // Quoted only once there is enough of the month behind it to mean
    // something. On the 2nd, scaling two days up to thirty says nothing.
    pace: isCurrent && daysElapsed >= 10 ? round2((spent / daysElapsed) * daysInMonth) : null,
    actionable, fixedRows, unjudged,
    recoverable: round2(actionable.reduce((s, r) => s + r.over, 0)),
  };
}

// ---------- Review tab: presentation helpers ----------
//
// The tab reports nine things about a month, which read as a wall when they are
// all open at once. So each is a section that remembers whether it is open, and
// a CLOSED one still carries its headline figure in the header - the point being
// that a collapsed section should answer its own question in one glance and only
// be opened for the working behind it.
//
// Open state is per section id and survives a re-render (switching month, or
// logging a spend), so the tab stays arranged the way it was left.
const _rvwOpen = Object.create(null);
const RVW_DEFAULT_OPEN = { forecast: true, savings: true, look: true };

// ---------- Explanations, behind an i ----------
//
// A note that says HOW something is worked out is read once and then costs
// space on every visit afterwards. A note that carries a FIGURE is the content
// and stays where it is. So the first kind moves behind an i: one short line
// instead of a paragraph, and the prose is still a tap away for the visit where
// it is actually wanted.
export function openInfoSheet(title, text) {
  const paras = (Array.isArray(text) ? text : [text]).filter(Boolean);
  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [el('h2', { text: title })]
      .concat(paras.map((t) => el('p', { class: 'info-para', text: t })))
      .concat([el('button', { class: 'btn ghost info-close', text: 'Close', onclick: closeModal })])),
  ]));
}

// The one-line affordance that replaces a paragraph.
export function explainRow(title, text, label) {
  return el('button', {
    class: 'explain-row', type: 'button', 'aria-label': title,
    onclick: (e) => { e.stopPropagation(); openInfoSheet(title, text); },
  }, [
    el('span', { class: 'explain-i', text: 'i' }),
    el('span', { text: label || 'How this is worked out' }),
  ]);
}

export function rvwSection(host, id, icon, title, summary, build) {
  const open = _rvwOpen[id] == null ? !!RVW_DEFAULT_OPEN[id] : !!_rvwOpen[id];
  const body = el('div', { class: 'rvw-sec-body' + (open ? '' : ' hidden') });
  const head = el('button', { class: 'rvw-sec-head' + (open ? ' is-open' : ''), type: 'button' }, [
    el('span', { class: 'rvw-sec-ico', text: icon }),
    el('span', { class: 'rvw-sec-title', text: title }),
    summary == null ? document.createTextNode('')
      : (typeof summary === 'string' ? el('span', { class: 'rvw-sec-sum', text: summary }) : summary),
    el('span', { class: 'rvw-sec-chev' }),
  ]);
  head.addEventListener('click', () => {
    const closed = body.classList.toggle('hidden');
    _rvwOpen[id] = !closed;
    head.classList.toggle('is-open', !closed);
  });
  host.appendChild(el('section', { class: 'rvw-sec' }, [head, body]));
  build(body);
}

// Cumulative spend for the month: a usual month, this month so far, and the
// forecast carrying on from where this month has got to. Three lines that
// answer "am I ahead or behind, and where does this end" without arithmetic.
//
// No stretched text: the viewBox scales uniformly and the labels ride inside
// it, so a wide screen enlarges the chart rather than distorting the type.
export function _rvwCurveChart(curve, o) {
  const ns = 'http://www.w3.org/2000/svg';
  const w = 320, h = 132, padL = 4, padR = 4, padT = 12, padB = 18;
  const mk = (t, attrs) => {
    const n = document.createElementNS(ns, t);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const dim = curve.length;
  const peak = Math.max(
    o.kitty || 0, o.forecast || 0,
    curve.reduce((m, pt) => Math.max(m, pt.usual || 0, pt.now || 0), 0), 1);
  const maxY = peak * 1.08;
  const X = (d) => padL + ((d - 1) / Math.max(1, dim - 1)) * (w - padL - padR);
  const Y = (v) => h - padB - (Math.max(0, v) / maxY) * (h - padT - padB);
  const svg = mk('svg', { viewBox: '0 0 ' + w + ' ' + h, style: 'width:100%;height:auto;display:block' });

  // Baseline and day ticks. Four labels only - the shape is the message, and a
  // tick every day would be noise at this size.
  svg.appendChild(mk('line', { x1: padL, y1: Y(0), x2: w - padR, y2: Y(0), stroke: '#334155', 'stroke-width': '1' }));
  [1, Math.round(dim / 3), Math.round((dim / 3) * 2), dim].forEach((d) => {
    const t = mk('text', { x: X(d), y: h - 5, fill: '#7c8db5', 'font-size': '9', 'text-anchor': d === 1 ? 'start' : d === dim ? 'end' : 'middle' });
    t.textContent = String(d);
    svg.appendChild(t);
  });

  // The kitty, as the line the month is trying to stay under.
  if (o.kitty > 0 && o.kitty <= maxY) {
    svg.appendChild(mk('line', { x1: padL, y1: Y(o.kitty), x2: w - padR, y2: Y(o.kitty), stroke: '#34d399', 'stroke-width': '1.2', 'stroke-dasharray': '5 4', opacity: '0.85' }));
    const t = mk('text', { x: w - padR, y: Y(o.kitty) - 4, fill: '#34d399', 'font-size': '9', 'text-anchor': 'end' });
    t.textContent = o.limitLabel || 'household budget';
    svg.appendChild(t);
  }

  // A usual month.
  svg.appendChild(mk('polyline', {
    points: curve.map((pt) => X(pt.day).toFixed(1) + ',' + Y(pt.usual).toFixed(1)).join(' '),
    fill: 'none', stroke: '#7c8db5', 'stroke-width': '1.8', 'stroke-linejoin': 'round',
  }));

  // This month, up to today.
  const done = curve.filter((pt) => pt.now != null);
  if (done.length) {
    svg.appendChild(mk('polyline', {
      points: done.map((pt) => X(pt.day).toFixed(1) + ',' + Y(pt.now).toFixed(1)).join(' '),
      fill: 'none', stroke: '#38bdf8', 'stroke-width': '2.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
    const last = done[done.length - 1];
    // The projection, dashed because it is the only estimated part of the
    // picture and should not be mistaken for what has happened.
    if (o.forecast != null && last.day < dim) {
      svg.appendChild(mk('line', {
        x1: X(last.day), y1: Y(last.now), x2: X(dim), y2: Y(o.forecast),
        stroke: '#38bdf8', 'stroke-width': '2', 'stroke-dasharray': '4 4', opacity: '0.85',
      }));
      svg.appendChild(mk('circle', { cx: X(dim), cy: Y(o.forecast), r: '3', fill: '#0b1220', stroke: '#38bdf8', 'stroke-width': '1.8' }));
    }
    svg.appendChild(mk('circle', { cx: X(last.day), cy: Y(last.now), r: '3.4', fill: '#38bdf8' }));
  }
  return svg;
}

// A category's recent months as bars, with its median marked. Revealed when a
// row is tapped: the claim is "usually X a month", and this is the evidence for
// it in a form that can be checked at a glance.
export function _rvwMonthBars(rows, usual) {
  const peak = Math.max(usual || 0, rows.reduce((m, r) => Math.max(m, r.amount), 0), 1);
  const wrap = el('div', { class: 'rvw-bars' });
  rows.forEach((r) => {
    wrap.appendChild(el('div', { class: 'rvw-bar-cell' + (r.current ? ' is-now' : '') }, [
      el('span', { class: 'rvw-bar-amt', text: r.amount > 0 ? fmtIntCur(r.amount) : '\u2014' }),
      el('span', { class: 'rvw-bar-track' }, [
        el('span', { class: 'rvw-bar-fill', style: 'height:' + Math.max(2, (r.amount / peak) * 100).toFixed(1) + '%' }),
      ]),
      el('span', { class: 'rvw-bar-mon', text: _spendMonthLabel(r.ym).split(' ')[0] }),
    ]));
  });
  const out = el('div', { class: 'rvw-bars-wrap' }, [wrap]);
  if (usual > 0) {
    out.appendChild(el('div', { class: 'rvw-bars-foot', text: 'median ' + fmtIntCur(usual) + ' a month' }));
  }
  return out;
}

async function renderReview(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  const [allocs, allSpends, efLoans] = await Promise.all([
    DB.all('allocations').catch(() => []),
    DB.all('spends').catch(() => []),
    DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
  ]);
  if (expRenderStale(token)) return;

  const byYm = new Map();
  (allSpends || []).forEach((r) => {
    const k = String(r.ym || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    if (!byYm.has(k)) byYm.set(k, []);
    byYm.get(k).push(r);
  });

  // THIS MONTH, always. There is no month strip here on purpose.
  //
  // Everything this tab does is about a month that can still be changed:
  // forecasting where it lands, naming what has already gone wrong in it,
  // pointing at what to stop doing for the rest of it. Run against a closed
  // month all of that becomes a post-mortem - a forecast of a month that has
  // already happened, advice for days that are gone - and the useful reading
  // gets buried under months nobody can act on.
  //
  // History has not gone anywhere: it is what every comparison here is made
  // AGAINST. It is just no longer something to browse.
  const ym = thisYm;

  // House Exp is per YEAR, so a window spanning a year boundary has more than
  // one kitty in it. Looked up by month rather than assumed constant.
  const kittyOf = (k) => _kittyFor(k, allocs, efLoans);
  const kitty = kittyOf(ym);
  const a = _reviewAnalysis(ym, byYm, thisYm, kitty, now);

  _rvwScopeLine(host, mod, ym, a, byYm);

  if (!a.spent) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🔍' }),
      el('p', { text: 'Nothing logged this month yet.' }),
      el('p', { class: 'hint', text: 'This tab reads the Tracker and only ever looks at the month you are in — '
        + 'log some spends and it will forecast where the month lands and tell you which of them are unusual for you.' }),
    ]));
    return;
  }

  // ---- Headline ----
  const overKitty = a.overKitty;
  const headBits = [
    el('div', { class: 'rvw-head-fig' + (overKitty > 0 ? ' is-over' : '') },
      [fmtSheetCur(a.spent) + (a.kitty > 0 ? ' of ' + fmtSheetCur(a.kitty) : '')]),
  ];
  const headNotes = [];
  if (a.kitty > 0) {
    headNotes.push(overKitty > 0
      ? 'Over the household budget by ' + fmtSheetCur(overKitty)
      : fmtSheetCur(-overKitty) + ' still in the household budget');
  }
  if (a.isCurrent) headNotes.push(perDayLabel(a.daysLeft + 1));
  // No straight-line pace figure here any more. Dividing by days elapsed and
  // multiplying by days in the month ignores that rent lands on the 5th, which
  // makes it wildly high early in a month and low late in one. The forecast
  // card below replaces it with an estimate built only from the remainder.
  headBits.push(el('div', { class: 'rvw-head-note', text: headNotes.join(' · ') }));
  host.appendChild(el('div', { class: 'rvw-head' }, headBits));

  // ---- Not enough history to judge anything ----
  if (a.historyMonths < REVIEW_MIN_HISTORY) {
    host.appendChild(el('div', { class: 'rvw-thin' }, [
      el('div', { class: 'rvw-thin-head', text: 'Not enough history yet' }),
      el('div', { class: 'rvw-thin-sub', text: 'There ' + (a.historyMonths === 1 ? 'is 1 earlier month' : 'are ' + a.historyMonths + ' earlier months')
        + ' on record. Comparing a category against its own normal needs at least ' + REVIEW_MIN_HISTORY
        + ', so this tab holds off rather than calling something unusual on one data point.' }),
    ]));
    return;
  }

  // Everything computed first, so a section header can carry its own headline
  // figure while closed - the summary has to exist before the section is built.
  const due = a.isCurrent ? _recurringDue(ym, byYm) : [];
  const dueTotal = round2(due.reduce((sum, r) => sum + r.amount, 0));
  const small = _reviewSmallTickets(ym, byYm);
  const cycle = _reviewCycle(ym, byYm, now, a.isCurrent);
  const forecast = a.isCurrent ? _reviewForecast(ym, byYm, now, dueTotal, kitty) : null;
  const savings = _reviewSavings(a, cycle, small, _smallTicketUsual(ym, byYm));
  const creeping = _reviewCreeping(ym, byYm);
  const prevD = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYm = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
  const methods = _reviewMethods(ym, byYm, prevYm);
  const fit = _reviewKittyFit(ym, byYm, kittyOf, thisYm);

  // ---- Where this month lands ----
  if (forecast) {
    const f = forecast;
    const grade = el('span', { class: 'rvw-grade is-' + f.grade,
      text: f.errPct != null ? f.grade + ' · ' + '\u00b1' + f.errPct + '%' : f.grade });
    rvwSection(host, 'forecast', '\ud83d\udd2e', 'Where this month lands', grade, (body) => {
      const curve = _reviewCurve(ym, byYm, f.day);
      body.appendChild(el('div', { class: 'rvw-fc' }, [
        el('div', { class: 'rvw-fc-top' }, [
          el('div', {}, [
            el('div', { class: 'rvw-fc-big' + (f.overKitty > 0 ? ' is-over' : ''), text: fmtSheetCur(f.forecast) }),
            el('div', { class: 'rvw-fc-lbl', text: 'forecast for ' + mod.monthLabel(ym) }),
          ]),
          el('div', { class: 'rvw-fc-range' }, [
            el('div', { class: 'rvw-fc-range-lbl', text: 'likely between' }),
            el('div', { class: 'rvw-fc-range-val', text: fmtSheetCur(f.lo) + ' – ' + fmtSheetCur(f.hi) }),
          ]),
        ]),
        // The month as a picture: where it has got to, where a usual month
        // would be by now, and where this one is heading.
        curve ? el('div', { class: 'rvw-chart' }, [_rvwCurveChart(curve, { kitty, forecast: f.forecast })]) : document.createTextNode(''),
        el('div', { class: 'rvw-fc-split' }, [
          el('span', {}, [el('i', { class: 'rvw-dot is-spent' }), fmtSheetCur(f.spent) + ' spent']),
          el('span', {}, [el('i', { class: 'rvw-dot is-proj' }), fmtSheetCur(f.rest) + ' to come']),
          el('span', {}, [el('i', { class: 'rvw-dot is-usual' }), 'a usual month']),
        ]),
      ]));

      // The lines that actually decide today, in the order they get acted on:
      // what the rest of the month usually costs, what is affordable if the
      // kitty is to hold, and where this month sits against a usual one.
      const lines = [];
      if (f.restPerDay != null) {
        lines.push(['-', 'The rest of your month usually costs ' + fmtIntCur(f.restPerDay)
          + ' a day · the ' + f.daysLeft + (f.daysLeft === 1 ? ' day' : ' days') + ' after today']);
      }
      if (f.fitPerDay != null) {
        lines.push(f.fitPerDay > 0
          ? ['OK', fmtIntCur(f.fitPerDay) + ' a day for the ' + perDayLabel(f.fitDays)
              + ', to stay inside the ' + fmtSheetCur(kitty) + ' household budget']
          : ['NO', 'The household budget is already spent · anything from here is over it']);
      }
      if (f.overKitty != null && f.overKitty > 0) {
        lines.push(['NO', 'On this estimate the month ends ' + fmtSheetCur(f.overKitty) + ' over the household budget']);
      } else if (f.overKitty != null) {
        lines.push(['OK', 'On this estimate the month ends ' + fmtSheetCur(-f.overKitty) + ' inside the household budget']);
      }
      if (f.usualByNow > 0) {
        lines.push([f.vsUsualByNow > 0 ? 'UP' : 'DOWN', 'By the ' + f.day + _ordinalSuffix(f.day)
          + ' a usual month is at ' + fmtIntCur(f.usualByNow) + ' · you are '
          + fmtIntCur(Math.abs(f.vsUsualByNow)) + (f.vsUsualByNow > 0 ? ' above that' : ' below that')]);
      }
      if (f.restIsDueFloor && f.due > 0) {
        lines.push(['-', 'Held up to ' + fmtSheetCur(f.due) + ' by items still expected below, which is more than a usual remainder']);
      }
      body.appendChild(el('div', { class: 'rvw-lines' }, lines.map(([kind, text]) => el('div', {
        class: 'rvw-line is-' + kind.toLowerCase(),
      }, [
        el('span', { class: 'rvw-line-mark', text: kind === 'OK' ? '\u2713' : kind === 'NO' ? '!' : kind === 'UP' ? '\u2191' : kind === 'DOWN' ? '\u2193' : '\u2022' }),
        el('span', { text }),
      ]))));

      body.appendChild(explainRow('How the forecast works', f.errPct != null
        ? 'Only the REMAINDER is estimated · what is already spent is counted, and the days still to come are priced from what the same days cost in your last '
          + f.months + ' months. Run against those months at the same point in the month, this came out a median '
          + f.errPct + '% away from what they actually cost.'
        : 'Only the REMAINDER is estimated · what is already spent is counted, and the days still to come are priced from what the same days cost in your last '
          + f.months + ' months. Too few months to have tested it against yet, so treat it as a rough shape.', 'About this estimate'));
    });
  }

  // ---- Where you could keep money ----
  if (savings.rows.length) {
    const top = savings.rows[0];
    rvwSection(host, 'savings', '\ud83d\udca1', 'Where you could keep money',
      savings.rows.length + (savings.rows.length === 1 ? ' place' : ' places'), (body) => {
        body.appendChild(el('div', { class: 'rvw-save-list' }, savings.rows.map((r) => el('div', {
          class: 'rvw-save-row ' + _spendGroupClass(r.group),
        }, [
          el('div', { class: 'rvw-save-body' }, [
            el('div', { class: 'rvw-save-name', text: r.name }),
            el('div', { class: 'rvw-save-how', text: r.how }),
          ]),
          el('div', { class: 'rvw-save-fig' }, [
            el('div', { class: 'rvw-save-val', text: r.kind === 'weekend' ? fmtIntCur(r.save) : fmtSheetCur(r.save) }),
            el('div', { class: 'rvw-save-unit', text: r.kind === 'weekend' ? 'a day' : 'this month' }),
          ]),
        ]))));
        body.appendChild(explainRow('Why these overlap', 'These overlap on purpose and are not added up — the same '
          + 'spend can be a small one, a weekend one and an over-median one at once. Three ways of seeing one leak is useful; '
          + 'counting it three times is not. The one figure that IS a total is under Worth a look, where the evidence for it sits.', 'Why these are not added up'));
      });
    void top;
  }

  // ---- Worth a look ----
  // Rows open on tap to show the category's own recent months, so "usually
  // 4,480 a month" can be checked rather than taken on trust.
  rvwSection(host, 'look', '\u26a0\ufe0f', 'Worth a look',
    a.actionable.length ? fmtSheetCur(a.recoverable) : 'nothing unusual', (body) => {
      if (!a.actionable.length) {
        body.appendChild(el('div', { class: 'rvw-clear' }, [
          el('span', { text: '\u2705' }),
          el('div', {}, [
            el('div', { class: 'rvw-clear-head', text: 'Nothing unusual this month' }),
            el('div', { class: 'rvw-clear-sub', text: 'Every category you can act on is at or below its own normal.' }),
          ]),
        ]));
        return;
      }
      const wrap = el('div', { class: 'rvw-list' });
      a.actionable.forEach((r) => {
        const bits = [r.count + '\u00d7 this month'];
        if (r.usualCount) bits.push('usually ' + r.usualCount + '\u00d7');
        if (r.driver) bits.push(r.driver);
        const detail = el('div', { class: 'rvw-item-detail hidden' });
        let built = false;
        const item = el('div', { class: 'rvw-item is-tappable ' + _spendGroupClass(r.group) }, [
          el('div', { class: 'rvw-item-top' }, [
            el('span', { class: 'rvw-item-name' }, [el('span', { class: 'rvw-item-dot' }), el('span', { text: r.name })]),
            el('span', { class: 'rvw-item-amt', text: fmtSheetCur(r.now) }),
          ]),
          el('div', { class: 'rvw-item-mid', text: 'Usually ' + fmtSheetCur(r.usual) + ' a month · ' + bits.join(' · ') }),
          el('div', { class: 'rvw-item-save' }, [
            el('span', { class: 'rvw-save-amt', text: fmtSheetCur(r.over) }),
            el('span', { class: 'rvw-save-txt', text: 'above a normal month — that much back if it returns to usual' }),
          ]),
          detail,
        ]);
        item.addEventListener('click', () => {
          // Built on first open only: six months of bars per category adds up
          // on a month with a dozen findings.
          if (!built) { detail.appendChild(_rvwMonthBars(_catMonthHistory(r.name, ym, byYm, 6), r.usual)); built = true; }
          const closed = detail.classList.toggle('hidden');
          item.classList.toggle('is-open', !closed);
        });
        wrap.appendChild(item);
      });
      body.appendChild(wrap);
      body.appendChild(el('div', { class: 'rvw-total' }, [
        el('span', { class: 'rvw-total-label', text: 'Recoverable this month' }),
        el('span', { class: 'rvw-total-val', text: fmtSheetCur(a.recoverable) }),
      ]));
      body.appendChild(el('p', { class: 'hint rvw-note', text: 'Tap a row for that category\u2019s last six months.' }));
    });

  _rvwCreepingSection(host, creeping, _spendGroupClass);

  // ---- Small spends ----
  if (small) {
    rvwSection(host, 'small', '\ud83e\ude99', 'Small spends add up', fmtSheetCur(small.total), (body) => {
      body.appendChild(el('div', { class: 'rvw-panel' }, [
        el('div', { class: 'rvw-panel-top' }, [
          el('span', { class: 'rvw-panel-fig', text: fmtSheetCur(small.total) }),
          el('span', { class: 'rvw-panel-sub', text: small.count + ' entries under ' + fmtSheetCur(small.threshold) }),
        ]),
        el('div', { class: 'rvw-item-mid', text: small.entryShare + '% of this month\u2019s entries · '
          + small.valueShare + '% of what was spent' }),
        el('div', { class: 'rvw-mini' }, small.top.map((t) => el('div', { class: 'rvw-mini-row' }, [
          el('span', { text: t.name }),
          el('span', { class: 'rvw-mini-meta', text: t.count + '\u00d7 · ' + fmtSheetCur(t.total) }),
        ]))),
      ]));
    });
  }

  // ---- Your spending cycle ----
  if (cycle) {
    rvwSection(host, 'cycle', '\ud83d\udd01', 'Your spending cycle',
      cycle.halfBy ? 'half gone by the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy) : null, (body) => {
        const THIRDS = [['Early', '1–10'], ['Middle', '11–20'], ['Late', '21–' + cycle.dim]];
        // Tap a third to see what makes it heavy. The shape of a month is only
        // actionable once you know which bills are sitting in that hump.
        const breakdown = el('div', { class: 'rvw-cyc-detail hidden' });
        let openThird = -1;
        const segs = cycle.thirds.map((pct, i) => {
          const seg = el('button', {
            type: 'button', class: 'rvw-cyc-seg is-t' + i, style: 'width:' + pct + '%',
            text: pct >= 12 ? pct + '%' : '',
            title: THIRDS[i][0] + ' ' + THIRDS[i][1],
          });
          seg.addEventListener('click', () => {
            if (openThird === i) { breakdown.classList.add('hidden'); openThird = -1; return; }
            openThird = i;
            breakdown.innerHTML = '';
            breakdown.classList.remove('hidden');
            breakdown.appendChild(el('div', { class: 'rvw-cyc-detail-head',
              text: THIRDS[i][0] + ' · day ' + THIRDS[i][1] + ' · ' + pct + '% of a usual month' }));
            const tops = (cycle.thirdTops[i] || []);
            if (!tops.length) {
              breakdown.appendChild(el('div', { class: 'rvw-mini-row' }, [el('span', { text: 'Nothing regular in these days.' })]));
              return;
            }
            tops.forEach((t) => breakdown.appendChild(el('div', { class: 'rvw-mini-row' }, [
              el('span', { text: t.name }),
              el('span', { class: 'rvw-mini-meta', text: fmtIntCur(t.amount) + ' a month' }),
            ])));
          });
          return seg;
        });
        body.appendChild(el('div', { class: 'rvw-cyc' }, [
          el('div', { class: 'rvw-cyc-bar' }, segs),
          el('div', { class: 'rvw-cyc-legend' }, THIRDS.map(([name, range], i) => el('span', { class: 'rvw-cyc-key' }, [
            el('i', { class: 'rvw-dot is-t' + i }),
            el('span', { class: 'rvw-cyc-key-name', text: name }),
            el('span', { class: 'rvw-cyc-key-range', text: range }),
          ]))),
          breakdown,
          el('div', { class: 'rvw-cyc-tap', text: 'Tap a band to see what sits in it' }),
        ]));

        // The week, as seven bars. A table of averages says the same thing but
        // needs reading; the tall bar is the answer.
        if (cycle.perDow && cycle.perDow.some((d) => d.perDay > 0)) {
          const peak = cycle.perDow.reduce((m, d) => Math.max(m, d.perDay), 1);
          body.appendChild(el('div', { class: 'rvw-dow' }, cycle.perDow.map((d) => el('div', {
            class: 'rvw-dow-cell' + (d.i === 0 || d.i === 6 ? ' is-weekend' : ''),
          }, [
            el('span', { class: 'rvw-dow-amt', text: d.perDay > 0 ? fmtIntCur(d.perDay) : '\u2014' }),
            el('span', { class: 'rvw-dow-track' }, [
              el('span', { class: 'rvw-dow-fill', style: 'height:' + Math.max(2, (d.perDay / peak) * 100).toFixed(1) + '%' }),
            ]),
            el('span', { class: 'rvw-dow-lbl', text: d.name.slice(0, 3) }),
          ]))));
        }

        const cycRows = [];
        if (cycle.halfBy) cycRows.push(['Half a month is gone by', 'the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy)]);
        if (cycle.weekendPerDay > 0) cycRows.push(['Weekend vs weekday, per day',
          fmtIntCur(cycle.weekendPerDay) + ' vs ' + fmtIntCur(cycle.weekdayPerDay)]);
        if (cycle.weekendShare != null) cycRows.push(['Lands on a Saturday or Sunday', cycle.weekendShare + '% of a month']);
        cycRows.push(['Days with nothing spent', a.isCurrent
          ? cycle.noSpendSoFar + ' of the first ' + cycle.daysSoFar + ' · usually ' + cycle.noSpendTypical + ' in a month'
          : 'usually ' + cycle.noSpendTypical + ' in a month']);
        body.appendChild(el('div', { class: 'rvw-flat' }, cycRows.map(([k, v]) =>
          el('div', { class: 'rvw-flat-row' }, [el('span', { text: k }), el('span', { class: 'rvw-flat-meta', text: v })]))));
        body.appendChild(explainRow('Your spending cycle', 'From your last ' + cycle.months
          + ' months. This is the WHEN behind the total — the half of a spending habit that a monthly figure hides, '
          + 'and the reason a forecast on the 6th and one on the 26th cannot use the same arithmetic.', 'How this is measured'));
      });
  }

  // ---- Still expected this month ----
  if (a.isCurrent && due.length) {
    rvwSection(host, 'due', '\ud83d\udcc5', 'Still expected this month', '~' + fmtIntCur(dueTotal), (body) => {
      body.appendChild(el('div', { class: 'rvw-due' }, due.map((r) => el('div', { class: 'rvw-due-row' }, [
        el('div', { class: 'rvw-due-when' }, [
          el('span', { class: 'rvw-due-day', text: r.day ? String(r.day) : '?' }),
          el('span', { class: 'rvw-due-daylbl', text: r.day ? _ordinalSuffix(r.day) : 'any' }),
        ]),
        el('div', { class: 'rvw-due-body' }, [
          el('div', { class: 'rvw-due-name', text: r.name }),
          el('div', { class: 'rvw-due-meta', text: r.months + ' of the last ' + r.window + ' months'
            + (r.day ? '' : ' · no settled date') + (r.fixed ? ' · fixed' : '') }),
        ]),
        el('span', { class: 'rvw-due-amt', text: '~' + fmtIntCur(r.amount) }),
      ]))));
      // No running total here. It would only ever count items that RECUR, so it
      // sat below the forecast by everything ordinary a month also costs, and
      // two forward totals that disagree are worse than one.
      body.appendChild(explainRow('What is still to land', 'Items that have landed in most recent months and have not yet this one. '
        + 'A description of what keeps happening, not a promise about this month.', 'How these are picked'));
    });
  }

  _rvwMethodsSection(host, methods, ' It is also what feeds this month\u2019s card reimbursement.');
  _rvwFitSection(host, fit, {
    word: 'household budget',
    // The kitty is House Exp DOUBLED, so a suggested figure is only actionable
    // once it is halved back into the line actually typed on Allocation.
    each: (f) => ' — that is ' + fmtSheetCur(round2(f.suggested / 2)) + ' each on House Exp',
  });

  // ---- Context: what wasn't judged, and what can't be ----
  if (a.unjudged.length) {
    rvwSection(host, 'new', '\ud83d\udd53', 'Too new to judge', String(a.unjudged.length), (body) => {
      body.appendChild(el('div', { class: 'rvw-flat' }, a.unjudged.map((r) =>
        el('div', { class: 'rvw-flat-row' }, [
          el('span', { text: r.name }),
          el('span', { class: 'rvw-flat-meta', text: fmtSheetCur(r.now) + ' · ' + (r.months ? r.months + ' earlier month' + (r.months === 1 ? '' : 's') : 'first time') }),
        ]))));
      body.appendChild(explainRow('Too new to judge', 'A category needs ' + REVIEW_MIN_HISTORY
        + ' earlier months before it has a normal to be compared with.', 'Why these are held back'));
    });
  }
  if (a.fixedRows.length) {
    const fixedTotal = round2(a.fixedRows.reduce((sum, r) => sum + r.now, 0));
    rvwSection(host, 'fixed', '\ud83d\udd12', 'Nothing to decide', fmtSheetCur(fixedTotal), (body) => {
      body.appendChild(el('div', { class: 'rvw-flat' }, a.fixedRows.map((r) =>
        el('div', { class: 'rvw-flat-row' }, [
          el('span', { text: r.name }),
          el('span', { class: 'rvw-flat-meta', text: fmtSheetCur(r.now) }),
        ]))));
      body.appendChild(explainRow('Nothing to decide', 'Rent, bills and medicine — real money, but not this month\u2019s decisions, '
        + 'so they are kept out of the comparisons above rather than flagged every month for being large.', 'Why these are set aside'));
    });
  }

  host.appendChild(explainRow('How this tab reads your months', 'Each category is compared with its own median month from your own entries — not a target, and not an average, which one unusual month would skew. Only categories already past a normal month appear.', 'About these figures'));
}

// Which month this is, how far into it, and what history is behind the figures.
//
// Both windows are named because they differ, and a tab that showed a category
// compared against ten months next to a cycle built on one - without saying so -
// would look broken rather than careful. See DAY_DETAIL_FROM_YM for why.
export function _rvwScopeLine(host, mod, ym, a, byYm) {
  const catMonths = a.historyMonths;
  const dayMonths = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k)
    && (byYm.get(k) || []).length > 0).length;
  const bits = ['day ' + a.daysElapsed + ' of ' + a.daysInMonth];
  if (catMonths > 0) bits.push(catMonths + (catMonths === 1 ? ' earlier month' : ' earlier months'));
  host.appendChild(el('div', { class: 'rvw-scope' }, [
    el('span', { class: 'rvw-scope-ym', text: mod.monthLabel(ym) }),
    el('span', { class: 'rvw-scope-note', text: bits.join(' · ') }),
  ]));
  if (catMonths > dayMonths) {
    host.appendChild(el('p', { class: 'hint rvw-scope-why', text: 'Category figures use all '
      + catMonths + ' earlier months. Anything about WHEN inside a month — the forecast, your '
      + 'spending cycle, when things land — uses only the '
      + (dayMonths === 0 ? 'months from ' + mod.monthLabel(DAY_DETAIL_FROM_YM) + ' on'
        : dayMonths + (dayMonths === 1 ? ' month' : ' months') + ' from ' + mod.monthLabel(DAY_DETAIL_FROM_YM) + ' on')
      + ', because earlier months were filled in from totals and their dates were never actually observed.' }));
  }
}

// ---------- Sections both Review tabs draw ----------
//
// Written once rather than copied, because the two tabs are asking the same
// question of different money - what is drifting, how it was paid, whether the
// limit is the right size - and a wording or a rule that drifted apart between
// them would be a bug nobody would ever notice.
export function _rvwCreepingSection(host, creeping, groupClass) {
  if (!creeping.length) return;
  rvwSection(host, 'creep', '\ud83d\udcc8', 'Creeping up',
    '+' + fmtSheetCur(creeping[0].rise) + ' ' + creeping[0].name, (body) => {
      body.appendChild(el('div', { class: 'rvw-list' }, creeping.map((r) =>
        el('div', { class: 'rvw-item ' + groupClass(r.group) }, [
          el('div', { class: 'rvw-item-top' }, [
            el('span', { class: 'rvw-item-name' }, [el('span', { class: 'rvw-item-dot' }), el('span', { text: r.name })]),
            el('span', { class: 'rvw-item-amt', text: '+' + fmtSheetCur(r.rise) + (r.risePct != null ? ' (' + r.risePct + '%)' : '') }),
          ]),
          el('div', { class: 'rvw-seq' }, r.seq.map((st) => el('span', { class: 'rvw-seq-step' }, [
            el('span', { class: 'rvw-seq-mon', text: _spendMonthLabel(st.ym).split(' ')[0] }),
            el('span', { class: 'rvw-seq-amt', text: fmtSheetCur(st.amount) }),
          ]))),
          el('div', { class: 'rvw-item-mid', text: 'Up every month for ' + r.months + ' months'
            + (r.fixed ? ' · fixed cost, but worth checking the rate' : '') }),
        ]))));
    });
}

export function _rvwMethodsSection(host, methods, cardNote) {
  if (!methods) return;
  const lead = methods.rows.slice().sort((x, y) => y.share - x.share)[0];
  rvwSection(host, 'method', '\ud83d\udcb3', 'How you paid',
    lead ? lead.method + ' ' + lead.share + '%' : null, (body) => {
      body.appendChild(el('div', { class: 'rvw-meth' }, methods.rows.map((r) => el('div', { class: 'rvw-meth-row' }, [
        el('span', { class: 'rvw-meth-name', text: r.method }),
        el('span', { class: 'rvw-meth-track' }, [
          el('span', { class: 'rvw-meth-fill is-' + r.method.toLowerCase(), style: 'width:' + Math.max(2, r.share) + '%' }),
        ]),
        el('span', { class: 'rvw-meth-amt', text: fmtSheetCur(r.amount) }),
        el('span', { class: 'rvw-meth-pct', text: r.share + '%' }),
      ]))));
      if (methods.cardAmount > 0) {
        const moved = methods.prevCardShare != null && Math.abs(methods.cardShare - methods.prevCardShare) >= 5
          ? ' Card was ' + methods.prevCardShare + '% last month.'
          : '';
        body.appendChild(el('p', { class: 'hint rvw-note', text: fmtSheetCur(methods.cardAmount)
          + ' of this month went on a card, so it lands on a statement later rather than being gone already.'
          + cardNote + moved }));
      }
    });
}

// `o.word` is what this money is called, `o.each` an extra clause for the
// suggestion where the limit is shared or doubled on its way in.
export function _rvwFitSection(host, fit, o) {
  if (!fit) return;
  const word = o.word;
  rvwSection(host, 'household budget', '\ud83e\uddee', 'Is the ' + word + ' right?',
    fit.overCount + ' of ' + fit.months + ' over', (body) => {
      const rows = [
        ['Over the ' + word, fit.overCount + ' of the last ' + fit.months + ' months'],
        ['Average overshoot', fit.avgOvershoot > 0 ? fmtSheetCur(fit.avgOvershoot) : '—'],
        ['Leanest month', _spendMonthLabel(fit.leanest.ym) + ' · ' + fmtSheetCur(fit.leanest.total)],
        ['Heaviest month', _spendMonthLabel(fit.heaviest.ym) + ' · ' + fmtSheetCur(fit.heaviest.total)],
      ];
      body.appendChild(el('div', { class: 'rvw-flat' }, rows.map(([k, v]) =>
        el('div', { class: 'rvw-flat-row' }, [el('span', { text: k }), el('span', { class: 'rvw-flat-meta', text: v })]))));
      // Only worth saying when a bigger limit would genuinely have covered more
      // months than the one that's set. Otherwise the limit is fine and the
      // spending is the story, which the sections above already tell.
      if (fit.suggested > fit.currentKitty && fit.covered > fit.coveredNow) {
        body.appendChild(el('p', { class: 'hint rvw-note', text: 'A ' + word + ' of ' + fmtSheetCur(fit.suggested)
          + ' would have covered ' + fit.covered + ' of those ' + fit.months + ' months, against '
          + fit.coveredNow + ' on the ' + fmtSheetCur(fit.currentKitty) + ' set now'
          + (o.each ? o.each(fit) : '') + '. Sized to cover all but the single '
          + 'heaviest month, so one unusual month does not set the budget.' }));
      } else if (fit.overCount === 0) {
        body.appendChild(el('p', { class: 'hint rvw-note', text: 'The ' + word
          + ' has covered every one of those months, so it looks about right.' }));
      }
    });
}

// Categories that keep turning up, and roughly when. This is pattern
// description, not prediction: "Rent appeared in 6 of the last 6 months, median
// day 5, median ₹14,000" is a statement about what already happened. It's the
// one forward-looking thing on this tab that doesn't require inventing a model
// — unlike projecting a spend LEVEL, which a couple of months can't support.
//
// Only reported for a category ABSENT from the selected month so far, since the
// useful question is what hasn't landed yet. "₹800 left in the kitty" means
// something very different when rent is still to go out.
const RECUR_LOOKBACK = 6;   // months of history considered
const RECUR_MIN_MONTHS = 3; // ...and the minimum needed before claiming a pattern

// 1st, 2nd, 3rd, 4th ... 21st, 22nd, 23rd, 31st. The teens are all 'th',
// which is why 11-13 are special-cased ahead of the last-digit rule.
export const _ordinalSuffix = (n) => {
  const d = Number(n) || 0;
  if (d % 100 >= 11 && d % 100 <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' })[d % 10] || 'th';
};

function _recurringDue(ym, byYm) {
  const hist = [...byYm.keys()].filter((k) => k < ym).sort().slice(-RECUR_LOOKBACK);
  if (hist.length < RECUR_MIN_MONTHS) return [];

  const already = new Set((byYm.get(ym) || []).map((r) => r.category || 'Prev Bill Bal / Misc'));
  const seen = new Map(); // name -> { months:Set, totals:[], days:[] }
  hist.forEach((k) => {
    const perCat = new Map();
    (byYm.get(k) || []).forEach((r) => {
      const n = r.category || 'Prev Bill Bal / Misc';
      const d = Number(String(r.date || '').slice(8, 10)) || 0;
      const e = perCat.get(n) || { total: 0, days: [] };
      e.total = round2(e.total + (Number(r.amount) || 0));
      if (d) e.days.push(d);
      perCat.set(n, e);
    });
    perCat.forEach((v, n) => {
      if (!seen.has(n)) seen.set(n, { months: new Set(), totals: [], days: [], dayMonths: new Set() });
      const e = seen.get(n);
      e.months.add(k);
      e.totals.push(v.total);
      // Split deliberately: whether a category turns up every month, and what
      // it usually costs, are month-level facts and read from all of history.
      // WHICH DAY it lands on is not, so days come only from months that were
      // logged as they happened. A long history still says "rent has not gone
      // out yet"; it just will not name the 5th until it has seen the 5th.
      if (dayDetailOk(k) && v.days.length) { v.days.forEach((d) => e.days.push(d)); e.dayMonths.add(k); }
    });
  });

  // Present in most of the window, not merely twice in six months.
  const threshold = Math.max(RECUR_MIN_MONTHS, Math.ceil(hist.length * 0.6));
  const out = [];
  seen.forEach((e, name) => {
    if (already.has(name)) return;          // already logged this month
    if (e.months.size < threshold) return;  // not regular enough to call
    // A date needs more than one month behind it. One observed month gives a
    // median of exactly that month and a spread of zero, which would announce
    // "usually the 5th" off a single sighting - the same false precision the
    // day floor exists to avoid, arrived at from the other direction.
    const enoughDays = e.dayMonths.size >= REVIEW_FORECAST_MIN;
    const day = enoughDays ? (Math.round(_median(e.days)) || null) : null;
    // How tightly the day clusters. A category that lands anywhere in the month
    // is still worth expecting, but naming a date for it would be false
    // precision, so the date is dropped instead of the row.
    const spread = e.days.length > 1
      ? Math.max.apply(null, e.days) - Math.min.apply(null, e.days)
      : 0;
    out.push({
      name, amount: _median(e.totals),
      day: spread <= 8 ? day : null,
      months: e.months.size, window: hist.length,
      fixed: _reviewIgnores(name),
    });
  });
  // Soonest first where a date is known, then the rest by size.
  out.sort((a, b) => {
    if (a.day && b.day && a.day !== b.day) return a.day - b.day;
    if (a.day && !b.day) return -1;
    if (!a.day && b.day) return 1;
    return b.amount - a.amount;
  });
  return out;
}

// ---------- Allocation tracker (Expense → Yearly plan tab) ----------
async function renderAllocation(host, token) {
  // This is called again on every year-switch and after every save (not just
  // on first entry to the tab, unlike most other renderX functions which are
  // only ever called once per tab-open from an already-cleared host) — clear
  // it every time or the whole section (header, year buttons, cards, total)
  // piles up underneath its previous copy instead of replacing it.
  host.innerHTML = '';
  const allAllocs = await DB.all('allocations').catch(() => []);
  if (expRenderStale(token)) return;
  const curYear = new Date().getFullYear();
  const allocYears = allAllocs.map(a => a.year).sort((a, b) => b - a);
  // Respect whichever year the user last selected/saved (_allocYear) as long
  // as it's still on record; otherwise fall back to the latest year.
  const selectedYear = allocYears.includes(ui._allocYear) ? ui._allocYear : (allocYears.length > 0 ? allocYears[0] : curYear);

  const allocCategories = [
    { key: 'salary', label: 'Salary', icon: '💼' },
    { key: 'home', label: 'Parents', icon: '🏠' },
    { key: 'houseExp', label: 'House Exp', icon: '🏡' },
    { key: 'card', label: 'Personal spending', icon: '💳' },
    { key: 'mf', label: 'MF', icon: '📈' },
    { key: 'emergency', label: 'Emergency', icon: '🚨' },
    { key: 'fd', label: 'FD', icon: '🏦' },
    { key: 'indStock', label: 'Ind Stock', icon: '📊' },
    { key: 'usStock', label: 'US Stock', icon: '🗽' },
    { key: 'metal', label: 'Metal', icon: '⭐' },
    { key: 'savings', label: 'Savings', icon: '💰' },
  ];

  const header = el('div', { class: 'alloc-header' }, [
    el('h3', { text: 'Annual Allocations' }),
    el('button', {
      class: 'btn primary small',
      text: '+ Add Year',
      onclick: () => openAllocForm(),
    }),
  ]);
  host.appendChild(header);

  if (allocYears.length === 0) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🧭' }),
      el('p', { text: 'No allocations recorded yet.' }),
      el('p', { class: 'hint', text: 'Click "Add Year" to start tracking how your income is allocated — you can enter this year or any past year.' }),
    ]));
    return;
  }

  // Year selector
  const yearSeg = el('div', { class: 'seg' }, allocYears.map(y =>
    el('button', {
      class: (y === selectedYear ? 'active' : ''),
      text: String(y),
      onclick: () => { ui._allocYear = y; renderHomeExpense(); },
    })
  ));
  host.appendChild(yearSeg);

  const curAlloc = allAllocs.find(a => a.year === selectedYear);
  const prevAlloc = allAllocs.find(a => a.year === selectedYear - 1);

  // Allocation cards with step-up %
  const allocWrap = el('div', { class: 'alloc-grid' });
  allocCategories.forEach(cat => {
    const val = curAlloc ? (curAlloc[cat.key] || 0) : 0;
    const prevVal = prevAlloc ? (prevAlloc[cat.key] || 0) : 0;
    const stepUp = prevVal > 0 ? (((val - prevVal) / prevVal) * 100) : (val > 0 ? 100 : 0);
    // Hide cards with both amount and percentage at 0
    const sharedAmt = cat.key === 'houseExp' && curAlloc && curAlloc.sharedOn ? Number(curAlloc.sharedAmount) || 0 : 0;
    if (val === 0 && stepUp === 0 && !sharedAmt) return;
    const stepUpClass = stepUp > 5 ? 'step-up-pos' : stepUp < -5 ? 'step-up-neg' : 'step-up-flat';

    // Display-only — editing happens through the single "Edit All Allocations"
    // button below, not by tapping an individual category card.
    const card = el('div', { class: 'alloc-card' }, [
      el('div', { class: 'alloc-cat-header' }, [
        el('span', { class: 'alloc-icon', text: cat.icon }),
        el('span', { class: 'alloc-label', text: cat.label }),
      ]),
      el('div', { class: 'alloc-value', text: '₹ ' + Number(val).toLocaleString('en-IN') }),
      el('div', { class: 'alloc-stepup ' + stepUpClass, text: (stepUp > 0 ? '▲' : stepUp < 0 ? '▼' : '—') + ' ' + Math.abs(Math.round(stepUp)) + '%' }),
      // Others' contribution to the house: a sub point of this card, counted in the household budget only.
      sharedAmt > 0 ? el('div', { class: 'alloc-sub', title: 'Counted in the household budget only, not added to your allocations' }, [
        el('span', { class: 'alloc-sub-l', text: '\u{1F91D} Shared by others' }),
        el('span', { class: 'alloc-sub-v', text: '+ \u20B9 ' + sharedAmt.toLocaleString('en-IN') }),
      ]) : null,
    ].filter(Boolean));
    allocWrap.appendChild(card);
  });


  // ---- Balance: what the salary has left after everything else ----
  //
  // Derived, never stored and never editable: it is the salary minus every
  // other line, so a stored copy could only ever disagree with the figures
  // above it. Shown even at zero, unlike the other cards, because "nothing
  // left" is the answer the card exists to give.
  //
  // Negative means the plan spends more than it earns, which is worth seeing
  // in red rather than hidden behind a clamp at zero.
  const balanceOf = (a) => {
    if (!a) return 0;
    const salary = Number(a.salary) || 0;
    const spent = allocCategories.reduce((sum, cat) =>
      (cat.key === 'salary' ? sum : sum + (Number(a[cat.key]) || 0)), 0);
    return round2(salary - spent);
  };
  const bal = balanceOf(curAlloc), prevBal = balanceOf(prevAlloc);
  const balStep = prevBal !== 0 ? ((bal - prevBal) / Math.abs(prevBal)) * 100 : (bal !== 0 ? 100 : 0);
  allocWrap.appendChild(el('div', { class: 'alloc-card alloc-card-balance' + (bal < 0 ? ' is-neg' : '') }, [
    el('div', { class: 'alloc-cat-header' }, [
      el('span', { class: 'alloc-icon', text: '⚖️' }),
      el('span', { class: 'alloc-label', text: 'Balance' }),
    ]),
    el('div', { class: 'alloc-value', text: '₹ ' + Number(bal).toLocaleString('en-IN') }),
    el('div', { class: 'alloc-stepup ' + (balStep > 5 ? 'step-up-pos' : balStep < -5 ? 'step-up-neg' : 'step-up-flat'),
      text: (balStep > 0 ? '▲' : balStep < 0 ? '▼' : '—') + ' ' + Math.abs(Math.round(balStep)) + '%' }),
  ]));
  host.appendChild(allocWrap);
  host.appendChild(el('p', { class: 'hint alloc-balance-note', text: bal < 0
    ? 'Balance is salary less every other line — negative here, so the plan allocates more than it earns.'
    : 'Balance is salary less every other line: what is left unallocated.' }));

  // Total row
  const totalVal = curAlloc ? allocCategories.reduce((sum, cat) => sum + (Number(curAlloc[cat.key]) || 0), 0) : 0;
  const prevTotalVal = prevAlloc ? allocCategories.reduce((sum, cat) => sum + (Number(prevAlloc[cat.key]) || 0), 0) : 0;
  const totalStepUp = prevTotalVal > 0 ? (((totalVal - prevTotalVal) / prevTotalVal) * 100) : 0;

  host.appendChild(el('div', { class: 'alloc-total' }, [
    el('div', { class: 'alloc-total-label', text: 'Total Annual Allocation' }),
    el('div', { class: 'alloc-total-value', text: '₹ ' + Number(totalVal).toLocaleString('en-IN') }),
    el('div', { class: 'alloc-total-stepup', text: '▲ ' + Math.round(totalStepUp) + '% YoY' }),
  ]));

  // Edit button
  host.appendChild(el('button', {
    class: 'btn secondary',
    text: '✎ Edit All Allocations',
    onclick: () => openAllocForm(selectedYear),
  }));
}

// Allocation form modal. `year` may be omitted (or null) — the year is
// editable inside the form itself, so the same modal handles adding a brand
// new year (including PAST years, to build up history for the step-up %
// insight) as well as editing an existing one.
// Opens this year's plan form straight away (the Get started card lands here, so the Free Plan has one tap
// to the form rather than a tab and a hunt for the button).
export function openAllocFormForThisYear() {
  ui._expTab = 'alloc';
  return openAllocForm(new Date().getFullYear());
}

async function openAllocForm(year = null) {
  const allAllocs = await DB.all('allocations');
  const curYear = new Date().getFullYear();
  const allocYears = allAllocs.map(a => a.year).sort((a, b) => a - b);

  // Default: edit the requested year, or if adding fresh, suggest the year
  // right before the earliest one on record (nudges toward filling in more
  // history) — or this year if nothing's recorded yet.
  const startYear = year != null ? year
    : allocYears.length ? allocYears[0] - 1
    : curYear;

  const blankAlloc = () => ({
    salary: 0, home: 0, houseExp: 0, card: 0, mf: 0,
    emergency: 0, fd: 0, indStock: 0, usStock: 0, metal: 0, savings: 0
  });

  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });
  const fields = {};
  const inputs = [];

  // Organize categories into groups
  const categoryGroups = [
    { group: 'Income', icon: '💼', categories: [{ key: 'salary', label: 'Salary', icon: '💰' }] },
    { group: 'Fixed Expenses', icon: '🏠', categories: [
      { key: 'home', label: 'Parents', icon: '🏠' },
      { key: 'houseExp', label: 'House Exp', icon: '🏡' },
      { key: 'card', label: 'Personal spending', icon: '💳' },
    ] },
    { group: 'Investments', icon: '📈', categories: [
      { key: 'mf', label: 'MF', icon: '📈' },
      { key: 'fd', label: 'FD', icon: '🏦' },
      { key: 'indStock', label: 'Ind Stock', icon: '📊' },
      { key: 'usStock', label: 'US Stock', icon: '🗽' },
      { key: 'metal', label: 'Metal', icon: '⭐' },
    ] },
    { group: 'Contingency', icon: '🛡️', categories: [
      { key: 'emergency', label: 'Emergency', icon: '🚨' },
      { key: 'savings', label: 'Savings', icon: '💰' },
    ] },
  ];

  const groupSections = categoryGroups.map(grp => {
    const rows = el('div', { class: 'alloc-form-rows' }, grp.categories.map(cat => {
      const inp = numInput(0, '0');
      fields[cat.key] = inp;
      inputs.push(inp);

      return el('div', { class: 'alloc-form-row' }, [
        el('div', { class: 'alloc-form-row-left' }, [
          el('span', { class: 'alloc-form-row-icon', text: cat.icon }),
          el('span', { class: 'alloc-form-row-label', text: cat.label }),
        ]),
        el('div', { class: 'alloc-form-row-input-wrap' }, [
          inp,
          el('span', { class: 'alloc-form-row-currency', text: '₹' }),
        ]),
      ]);
    }));

    return el('div', { class: 'alloc-form-section' }, [
      el('div', { class: 'alloc-form-section-header' }, [
        el('span', { class: 'alloc-form-section-icon', text: grp.icon }),
        el('h3', { class: 'alloc-form-section-title', text: grp.group }),
      ]),
      rows,
    ]);
  });

  // Someone else shares the house costs? Their monthly amount is added to the Tracker's Household budget.
  const sharedChk = el('input', { type: 'checkbox' });
  const sharedInp = numInput(0, '0');
  const sharedBox = el('div', { class: 'alloc-form-row alloc-shared-sub hidden' }, [
    el('div', { class: 'alloc-form-row-left' }, [el('span', { class: 'alloc-form-row-icon', text: '🤝' }), el('span', { class: 'alloc-form-row-label', text: 'Their monthly share of house expense' })]),
    el('div', { class: 'alloc-form-row-input-wrap' }, [sharedInp, el('span', { class: 'alloc-form-row-currency', text: '₹' })]),
  ]);
  sharedChk.addEventListener('change', () => sharedBox.classList.toggle('hidden', !sharedChk.checked));
  groupSections[1].appendChild(el('label', { class: 'alloc-shared-toggle' }, [sharedChk, el('span', { text: 'Does anyone else share the house expenses?' })]));
  groupSections[1].appendChild(sharedBox);
  groupSections[1].appendChild(el('p', { class: 'hint alloc-shared-note', text: 'Counted in the household budget only. It is not added to your allocations or Balance.' }));

  // Tracks the DB id of whatever year is currently loaded into the fields
  // (null = this year has no saved record yet, so Save will insert).
  let loadedId = null;
  let loadedYear = startYear;

  const existingBadge = el('span', { class: 'alloc-form-year-badge', text: '' });

  const loadYear = (y) => {
    loadedYear = y;
    const existing = allAllocs.find(a => a.year === y);
    const src = existing || blankAlloc();
    loadedId = existing ? existing.id : null;
    Object.keys(fields).forEach(key => { fields[key].value = src[key] || 0; });
    sharedChk.checked = !!src.sharedOn; sharedInp.value = src.sharedOn ? (Number(src.sharedAmount) || 0) : 0;
    sharedBox.classList.toggle('hidden', !sharedChk.checked);
    existingBadge.textContent = existing ? '✎ Editing saved entry' : '＋ New entry';
    existingBadge.classList.toggle('is-existing', !!existing);
    title.textContent = `Annual Allocation — ${y}`;
  };

  const yearInput = el('input', {
    type: 'number', inputmode: 'numeric', step: '1', value: startYear,
    class: 'alloc-form-year-input',
  });
  yearInput.addEventListener('change', () => {
    const y = parseInt(yearInput.value, 10);
    if (Number.isFinite(y)) loadYear(y);
  });

  const title = el('h2', { text: `Annual Allocation — ${startYear}` });

  const save = async () => {
    const y = parseInt(yearInput.value, 10);
    if (!Number.isFinite(y)) { toast('Enter a valid year'); return; }
    const rec = { year: y, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    Object.keys(fields).forEach(key => { rec[key] = Number(fields[key].value) || 0; });
    rec.sharedOn = sharedChk.checked;
    rec.sharedAmount = sharedChk.checked ? Math.max(0, Number(sharedInp.value) || 0) : 0;
    if (loadedId) rec.id = loadedId;
    await DB.put('allocations', rec);
    closeModal();
    ui._allocYear = y;
    renderHomeExpense();
    toast('Allocations saved for ' + y);
  };

  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      title,
      el('div', { class: 'alloc-form-year-picker' }, [
        el('label', { text: 'Year' }),
        yearInput,
        existingBadge,
      ]),
      el('div', { class: 'alloc-form-sections' }, groupSections),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, [
      el('button', { class: 'btn primary', text: 'Save Allocations', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ])]),
  ]));

  loadYear(startYear);

  if (inputs.length > 0) inputs[0].focus();
}


// Combined metals portfolio: digital gold + SGB (from Stocks, valued at the gold
// ₹/gram price) as one gold figure, plus silver. Shared by Home + Overview so the
// two never drift. SGB grams count as gold ("end of the day it's gold").
export async function metalPortfolio() {
  const mod = await import('./metal.js');
  let [txns, liveMeta, stocks] = await Promise.all([
    DB.all('metals').catch(() => []),
    DB.get('meta', 'homeLiveRates').catch(() => null),
    DB.all('stocks').catch(() => []),
  ]);
  // The manual "Set price" flow is gone (superseded by the Home strip's live
  // fetch, 2026-09-15) - if nothing has EVER been fetched yet (a fresh
  // install opened straight to Metals before Home got a chance to), fetch it
  // now rather than valuing every holding at ₹0.
  let live = (liveMeta && liveMeta.value) || null;
  if (!live) live = await _fetchLiveRates().catch(() => null) || {};
  const goldPrice = Number(live.gold) || 0, silverPrice = Number(live.silver) || 0;
  const gd = mod.summary(txns, 'gold', goldPrice);      // digital gold only
  const silver = mod.summary(txns, 'silver', silverPrice);
  const sgbs = stocks.filter(isSgb);
  let sgbGrams = 0, sgbInv = 0;
  sgbs.forEach((x) => { const u = Number(x.units) || 0; sgbGrams += u; sgbInv += u * (Number(x.buyPrice) || 0); });
  const grams = gd.grams + sgbGrams;
  const gold = {
    grams, invested: gd.invested + sgbInv, value: grams * goldPrice,
    realized: gd.realized, digital: gd, sgbGrams, sgbInv, sgbCount: sgbs.length, price: goldPrice,
  };
  gold.pl = gold.value - gold.invested;
  gold.plPct = gold.invested > 0 ? (gold.pl / gold.invested) * 100 : null;
  return { gold, silver, live, hasTxns: (txns || []).length > 0 };
}
export const _gramsShort = (x) => String(Math.round((Number(x) || 0) * 100) / 100);
