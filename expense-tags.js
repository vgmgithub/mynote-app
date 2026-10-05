import { thisYm, todayISO } from './core.js';
import { fmtIntCur, renderPersonal, tagsOf, isForOthers, TAG_MAX } from './personal-ui.js';
import { ui } from './state.js';
import { DB } from './db.js';
import { el, b, modOn, _modsCache, $, field } from './app.js';
import { _median } from './expense-review-logic.js';
import { _rvwMonthBars } from './expense-review.js';
import { _spendMonthLabel } from './expense-tracker.js';
import { round2, fmtSheetCur, fmtSigned, catList, pfRenderStale, _spendDayLabel } from './expense-ui.js';

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
const TAG_SOURCES = [['all', 'Both'], ['house', 'Household'], ['personal', 'Personal'], ['others', 'For Others']];
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
// `o.source` ('house' | 'personal') pins it to one side (see below).
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
    // Spending only (the owner's call): a refund is not a spend, so it is left out of every figure on this tab
    // rather than netted off - nothing here is ever a mix of money out and money back.
  })).filter((x) => /^\d{4}-\d{2}$/.test(x.ym) && x.amount > 0);

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
  // `o.source` locks the page to one side wherever it lives: Expenses -> Tags is household only, Personal Finance ->
  // Tags personal only; Analysis shows both with the chooser. The tags themselves are on the spend rows and are not
  // touched either way - this only decides which rows are read.
  const _hasHouse = modOn(_modsCache, 'expense') && o.source !== 'personal';
  const _hasPersonal = modOn(_modsCache, 'personal') && o.source !== 'house';
  // For Others is its own view: the spends made for somebody else, which every other view leaves out. Offered
  // wherever personal spending is (that is where "for others" is marked), so a page locked to Personal gets
  // Personal / For Others, and a household-only page has nothing to choose.
  const _tagSources = _hasHouse && _hasPersonal ? TAG_SOURCES
    : _hasPersonal ? TAG_SOURCES.filter(([v]) => v === 'personal' || v === 'others')
    : TAG_SOURCES.filter(([v]) => v === 'house');
  // A remembered choice that this page does not offer (it was made on another one) falls back to its first.
  const source = _tagSources.length === 1 ? _tagSources[0][0]
    : (_tagSources.some(([v]) => v === ui._tagSource) ? ui._tagSource : _tagSources[0][0]);
  const isOthers = source === 'others';
  const sideOk = (x) => (x.src === 'house' ? _hasHouse : _hasPersonal);
  const pool = isOthers ? allRaw.filter((x) => isForOthers(x.r) && sideOk(x)) : all;
  const inSource = (x) => isOthers || source === 'all' || x.src === source;
  const withinScope = (x) => (fromYm ? x.ym >= fromYm : true) && inSource(x);
  const scoped = pool.filter(withinScope);
  const forOthers = isOthers ? [] : allRaw.filter((x) => isForOthers(x.r) && withinScope(x));
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

  if (!pool.some(inSource)) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\ud83c\udff7\ufe0f' }),
      el('p', { text: isOthers ? 'Nothing spent for others yet.' : 'Nothing logged yet.' }),
      el('p', { class: 'hint', text: isOthers ? 'Mark a personal spend as for someone else and it turns up here.' : source === 'house' ? 'Tag a spend on the Tracker and it turns up here.'
        : source === 'personal' ? 'Tag a spend on Spends and it turns up here.'
          : 'Tag a spend on the household Tracker or on Personal Finance and it turns up here.' }),
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
        el('div', { class: 'tag-an-top' }, [
          el('span', { class: 'tag-pill', text: c.cat }),
          el('span', { class: 'tag-an-total', text: fmtSigned(c.total) }),
        ]),
        el('span', { class: 'tag-an-track' }, [
          el('span', { class: 'tag-an-fill', style: 'width:'
            + Math.max(1.5, (Math.abs(c.total) / topCat) * 100).toFixed(1) + '%' }),
        ]),
        el('span', { class: 'tag-an-meta', text: share.toFixed(0) + '% of these · ' + c.count + (c.count === 1 ? ' spend' : ' spends')
          + ' · ' + fmtIntCur(round2(gross / c.count))
          + ' each · ' + c.yms.size + (c.yms.size === 1 ? ' month' : ' months') }),
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
    // Two short lines: how many tags on how many entries, then how much is still untagged - as a share of ENTRIES,
    // with the part that needs doing in bold.
    ...(tags.length ? [
      el('p', { class: 'hint tag-cover-line', style: 'margin:10px 0 0', text: tags.length + (tags.length === 1 ? ' tag' : ' tags')
        + ' on ' + tagged.length + ' of ' + scoped.length + (scoped.length === 1 ? ' entry' : ' entries') }),
      tagged.length === scoped.length
        ? el('p', { class: 'hint tag-cover-line', style: 'margin:2px 0 0', text: 'Every entry is tagged.' })
        : el('p', { class: 'hint tag-cover-line', style: 'margin:2px 0 0' }, [
          document.createTextNode('Only ' + Math.max(1, Math.round(tagged.length / scoped.length * 100)) + '% of entries are tagged — '),
          el('b', { text: Math.min(99, 100 - Math.round(tagged.length / scoped.length * 100)) + '% still need a tag' }),
        ]),
    ] : [el('p', { class: 'hint', style: 'margin:10px 0 0', text: 'Nothing in this scope carries a tag yet.' })]),
    // Spends made for others, one line: left out of these figures, and where to see them.
    forOthers.length
      ? el('p', { class: 'hint tag-cover-others', style: 'margin:6px 0 0',
          text: fmtSheetCur(forOthersTotal) + ' for others (' + forOthers.length + (forOthers.length === 1 ? ' spend' : ' spends')
            + ') not counted' + (_tagSources.some(([v]) => v === 'others') ? ' · see For Others' : '') })
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
      el('div', { class: 'tag-an-top' }, [
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
      el('span', { class: 'tag-an-meta', text: share.toFixed(0) + '% of tagged' + ' · '
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
