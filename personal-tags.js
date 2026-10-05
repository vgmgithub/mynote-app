import { DB } from './db.js';
import { el, catList, REFUND_CAT, field, toast, round2, closeModal, fmtSheetCur, openModal, CAT_KINDS, saveCategoryList, b, SPEND_METHODS, refresh } from './app.js';

// ---------- Editing the category lists ----------
//
// One editor, two jobs. With no `group` it manages the CATEGORIES themselves
// (Food, Shopping); with one it manages that category's SUB-CATEGORIES (Eat
// Out, Clothes). Both look the same because they are the same problem: a list
// of names to rename, remove or add to.
//
// What happens to spends already filed under a name is the part that matters:
//
//   RENAME  - every entry using the old name is updated with it. Anything else
//             silently breaks month-on-month comparison at the rename, which is
//             the one thing these lists exist to make possible.
//   DELETE  - refused while entries still use the name, and it says how many.
//             Rename it, or move those spends, first. Nothing is orphaned
//             behind the user's back.
//
// A category is not deletable while it still holds sub-categories either, for
// the same reason: its items would have nowhere to live.
export async function openCatManager(kind, group, onDone) {
  const cfg = CAT_KINDS[kind];
  const list = catList(kind).map((g) => ({ group: g.group, items: (g.items || []).slice() }));
  const inGroup = group != null;
  const src = inGroup ? (list.find((g) => g.group === group) || { group, items: [] }) : null;
  // Original names, to work out afterwards what was renamed into what.
  const original = inGroup ? src.items.slice() : list.map((g) => g.group);
  const rows = original.slice();

  const spends = (await DB.all(cfg.store).catch(() => [])) || [];
  // How many entries a name is carrying. A category counts every spend in any
  // of its sub-categories.
  const usedBy = (name) => {
    if (inGroup) return spends.filter((r) => (r.category || '') === name).length;
    const g = list.find((x) => x.group === name);
    const items = g ? g.items : [];
    return spends.filter((r) => items.indexOf(r.category || '') >= 0).length;
  };

  const rowsWrap = el('div', { class: 'cat-rows' });
  const inputs = [];
  const removed = new Set();

  // Typed-but-unsaved names live in `rows`; `original` never moves, so a
  // rename stays distinguishable from a name that was always there.
  const syncFromInputs = () => { inputs.forEach(({ ix, inp }) => { rows[ix] = inp.value; }); };

  const draw = () => {
    rowsWrap.innerHTML = '';
    inputs.length = 0;
    rows.forEach((name, ix) => {
      if (removed.has(ix)) return;
      const used = usedBy(name);
      const held = !inGroup ? ((list.find((x) => x.group === name) || { items: [] }).items.length) : 0;
      const inp = el('input', { type: 'text', class: 'cat-name', value: name, 'aria-label': 'Name' });
      inputs.push({ ix, inp });
      const del = el('button', {
        class: 'icon-btn cat-del', type: 'button', text: '×',
        title: 'Remove ' + name, 'aria-label': 'Remove ' + name,
        onclick: () => {
          if (name === REFUND_CAT) {
            toast('Refund is built in — it is how money coming back is recorded');
            return;
          }
          if (used > 0) {
            toast(name + ' is on ' + used + ' ' + (used === 1 ? 'entry' : 'entries') + ' · rename it instead');
            return;
          }
          if (held > 0) {
            toast(name + ' still holds ' + held + ' sub-' + (held === 1 ? 'category' : 'categories'));
            return;
          }
          syncFromInputs();
          removed.add(ix);
          draw();
        },
      });
      rowsWrap.appendChild(el('div', { class: 'cat-row' + (used > 0 ? ' is-used' : '') }, [
        inp,
        el('span', { class: 'cat-used', text: used > 0 ? used + (used === 1 ? ' entry' : ' entries') : (held > 0 ? held + ' sub' : '') }),
        del,
      ]));
    });
    if (!rowsWrap.childElementCount) {
      rowsWrap.appendChild(el('p', { class: 'hint', style: 'margin:0', text: 'Nothing here yet.' }));
    }
  };
  draw();

  // The new-entry box. Enter adds without reaching for the button.
  const fresh = el('input', { type: 'text', class: 'cat-name',
    placeholder: inGroup ? 'New sub-category' : 'New category' });
  const addOne = () => {
    const v = fresh.value.trim();
    if (!v) return;
    const exists = rows.some((n, i) => !removed.has(i) && n.toLowerCase() === v.toLowerCase())
      || inputs.some((r) => r.inp.value.trim().toLowerCase() === v.toLowerCase());
    if (exists) { toast(v + ' is already on the list'); return; }
    syncFromInputs();
    rows.push(v);
    fresh.value = '';
    draw();
    fresh.focus();
  };
  fresh.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });

  const save = async () => {
    // Collect the surviving names in order, with whatever they were renamed to.
    syncFromInputs();
    const renames = [];      // [oldName, newName]
    const kept = [];
    inputs.forEach(({ ix }) => {
      const v = String(rows[ix] || '').trim();
      if (!v) return;                       // blanked out reads as removed
      // Compared against the name as LOADED, not against the working value,
      // which is the same string by now.
      const was = ix < original.length ? original[ix] : null;
      if (was != null && was !== v) renames.push([was, v]);
      kept.push(v);
    });
    if (!kept.length) { toast('Keep at least one'); return; }
    const dupe = kept.find((n, i) => kept.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i);
    if (dupe) { toast('Two entries named ' + dupe); return; }

    let next;
    if (inGroup) {
      next = list.map((g) => (g.group === group ? { group: g.group, items: kept } : g));
      if (!next.some((g) => g.group === group)) next = next.concat([{ group, items: kept }]);
    } else {
      // Group order is the order on screen, and the tracker's roll-up reads it,
      // so re-ordering here re-orders the month view too.
      const byOld = new Map(list.map((g) => [g.group, g.items]));
      const renameOf = new Map(renames);
      next = kept.map((name) => {
        const was = [...renameOf.entries()].find(([, to]) => to === name);
        const items = byOld.get(was ? was[0] : name) || [];
        return { group: name, items };
      });
    }
    await saveCategoryList(kind, next);

    // Carry the renames through the entries themselves. Only sub-category
    // renames touch a spend: a spend records its sub-category, and which
    // category that belongs to is looked up, never stored.
    if (inGroup && renames.length) {
      const map = new Map(renames);
      let moved = 0;
      for (const r of spends) {
        const to = map.get(r.category || '');
        if (!to) continue;
        await DB.put(cfg.store, Object.assign({}, r, { category: to, updatedAt: new Date().toISOString() }))
          .then(() => { moved++; }).catch(() => {});
      }
      if (moved) toast(moved + ' ' + (moved === 1 ? 'entry' : 'entries') + ' moved with the rename');
      else toast('Saved');
    } else {
      toast('Saved');
    }
    closeModal();
    if (onDone) onDone();
  };

  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: inGroup ? group : 'Categories' }),
      el('p', { class: 'hint', text: inGroup
        ? 'Sub-categories under ' + group + '. Renaming one moves every ' + cfg.label
          + ' entry already filed under it, so your month-on-month figures stay whole.'
        : 'Used by ' + cfg.label + '. The order here is the order the Tracker groups a month in.' }),
      rowsWrap,
      el('div', { class: 'cat-add' }, [
        fresh,
        el('button', { class: 'btn small primary', type: 'button', text: '+ Add', onclick: addOne }),
      ]),
      el('p', { class: 'hint', style: 'margin:10px 0 0', text: 'A name still in use cannot be removed \u2014 rename it instead, and its entries come with it.' }),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ])]),
  ]));
}

// The little + beside a label. Same button in both forms, both levels.
export function catAddBtn(title, onclick) {
  return el('button', {
    class: 'cat-add-btn', type: 'button', text: '+',
    title: title, 'aria-label': title,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); onclick(); },
  });
}

// ---------- Tags on a spend ----------
//
// A note is written once and read never. A tag is a HANDLE: the same word on
// twenty entries is something that can be counted, filtered and compared later,
// which a sentence never can. So spends carry `tags` - a small array of short,
// normalised words - in place of free text.
//
// Normalising on the way in is the whole point. "Weekly ", "weekly" and
// "#Weekly" have to become one tag or the system is just free text with chips
// drawn round it, and the counting it exists for never works.
export const TAG_MAX = 6;        // per entry - beyond this they stop being handles
const TAG_MAXLEN = 24;
export function normaliseTag(raw) {
  return String(raw == null ? '' : raw)
    .trim().toLowerCase()
    .replace(/^#+/, '')
    // Spaces and a few joiners survive; everything else would only ever create
    // near-duplicates of a tag that already exists.
    .replace(/[^a-z0-9 &/+-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAG_MAXLEN)
    .trim();
}
// Reading a record's tags, tolerant of what is actually on it: rows written
// before tags existed have none, and a legacy note is left alone rather than
// being chopped into words that were never meant as tags.
export function tagsOf(rec) {
  const t = rec && rec.tags;
  if (!Array.isArray(t)) return [];
  const out = [];
  t.forEach((x) => {
    const n = normaliseTag(x);
    if (n && out.indexOf(n) < 0) out.push(n);
  });
  return out.slice(0, TAG_MAX);
}
// Every tag already in use, most-used first. This is what turns a text box into
// a tag system: the suggestions are the reason the same word gets reused rather
// than retyped four different ways.
export function knownTags(rows) {
  const count = new Map();
  (rows || []).forEach((r) => tagsOf(r).forEach((t) => count.set(t, (count.get(t) || 0) + 1)));
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
// knownTags, but with this category's own tags moved to the front - the tags already linked to Groceries are the
// likely pick for the next Groceries spend, not just whatever is used most across every category.
export function knownTagsFor(rows, category) {
  if (!category) return knownTags(rows);
  const count = new Map();
  (rows || []).forEach((r) => { if (r && r.category === category) tagsOf(r).forEach((t) => count.set(t, (count.get(t) || 0) + 1)); });
  const own = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const ownSet = new Set(own);
  return own.concat(knownTags(rows).filter((t) => !ownSet.has(t)));
}

// The field: chips for what is chosen, a box to type a new one, and the tags
// already in use underneath to tap. Commits on Enter, comma or Tab - not on
// space, since a tag like "eat out" is two words and one handle.
export function tagField(current, suggestions, label) {
  let tags = tagsOf({ tags: current });
  const chips = el('div', { class: 'tag-chips' });
  const suggWrap = el('div', { class: 'tag-suggest' });
  const input = el('input', {
    type: 'text', class: 'tag-input', placeholder: 'Add a tag, then Enter',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
  });
  const count = el('span', { class: 'tag-count' });

  const add = (raw) => {
    const t = normaliseTag(raw);
    if (!t) return false;
    if (tags.indexOf(t) >= 0) return true;      // already on, and that is fine
    if (tags.length >= TAG_MAX) { toast('Up to ' + TAG_MAX + ' tags'); return false; }
    tags.push(t);
    draw();
    return true;
  };
  const remove = (t) => { tags = tags.filter((x) => x !== t); draw(); };

  function draw() {
    chips.innerHTML = '';
    tags.forEach((t) => {
      chips.appendChild(el('button', {
        type: 'button', class: 'tag-chip', title: 'Remove ' + t,
        onclick: () => remove(t),
      }, [el('span', { text: t }), el('i', { class: 'tag-chip-x', text: '×' })]));
    });
    chips.classList.toggle('hidden', !tags.length);
    count.textContent = tags.length ? tags.length + '/' + TAG_MAX : '';
    drawSuggest();
  }

  // The box doubles as a SEARCH over the tags already in use. Twenty tags in,
  // the strip underneath stops being a shortcut and becomes a wall - and the
  // whole point of a tag is that the same word gets reused rather than retyped
  // in a fourth shape, which only happens if the existing one is easy to find.
  function drawSuggest() {
    // Matched on the NORMALISED word, the same shape tags are stored in, so
    // "Weekly ", "#weekly" and "weekly" all find `weekly`.
    const q = normaliseTag(input.value);
    // Suggestions already chosen are dropped rather than shown inert - a chip
    // that does nothing when tapped is worse than no chip.
    const free = (suggestions || []).filter((t) => tags.indexOf(t) < 0);
    // `free` arrives most-used first (knownTags), which is the right order with
    // nothing typed. With a word typed, STARTS-WITH comes first and frequency
    // breaks the tie: the tag you are part-way through typing belongs under
    // your thumb, not behind a longer word that merely contains those letters.
    const rank = new Map(free.map((t, i) => [t, i]));
    const hits = q
      ? free.filter((t) => t.indexOf(q) >= 0)
        .sort((a, b) => (a.indexOf(q) - b.indexOf(q)) || (rank.get(a) - rank.get(b)))
      : free;
    const left = hits.slice(0, 12);
    suggWrap.innerHTML = '';
    left.forEach((t) => suggWrap.appendChild(el('button', {
      type: 'button', class: 'tag-sugg' + (t === q ? ' is-exact' : ''), text: t,
      // The typed fragment was the SEARCH, not a tag - clearing it matters
      // rather than merely tidies, because whatever is left in the box is
      // committed on save, so "we" would have ridden along beside "weekly".
      onclick: () => { add(t); input.value = ''; drawSuggest(); input.focus(); },
    })));
    // A word typed with nothing matching needs saying. An empty strip reads as
    // "the suggestions broke" rather than "this one will be new".
    if (!left.length && q && tags.length < TAG_MAX) {
      suggWrap.appendChild(el('span', { class: 'tag-sugg-none',
        text: free.length
          ? 'No tag matches “' + q + '” — Enter makes it a new one'
          : 'Enter makes “' + q + '” a tag' }));
    }
    suggWrap.classList.toggle('hidden', !suggWrap.childElementCount || tags.length >= TAG_MAX);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (!input.value.trim()) return;          // Tab still moves on when empty
      e.preventDefault();
      if (add(input.value)) input.value = '';
      drawSuggest();               // box cleared, so the filter lifts
      return;
    }
    // Backspace on an empty box takes the last chip off, which is what every
    // tag field does and what the fingers expect.
    if (e.key === 'Backspace' && !input.value && tags.length) remove(tags[tags.length - 1]);
  });
  input.addEventListener('input', () => {
    // Pasting "one, two" should not become a single tag with a comma in it.
    if (input.value.indexOf(',') >= 0) {
      const parts = input.value.split(',');
      input.value = parts.pop();
      parts.forEach(add);          // add() redraws, including the suggestions
    }
    drawSuggest();
  });
  // Whatever is half-typed when the sheet is saved counts - losing it because
  // Enter was not pressed is the classic way a tag field annoys people.
  const commitPending = () => { if (input.value.trim()) { add(input.value); input.value = ''; } };

  draw();
  const node = el('div', { class: 'tag-field' }, [
    el('div', { class: 'tag-field-head' + (label === null ? ' is-bare' : '') },
      (label === null ? [] : [el('span', { class: 'tag-field-label', text: label || 'Tags' })]).concat([count])),
    chips,
    input,
    suggWrap,
  ]);
  return {
    node, get: () => { commitPending(); return tags.slice(); },
    // The tags so far WITHOUT committing what is half-typed. The form reads this on every keystroke (to refresh its
    // summaries, or to keep a draft); get() would turn each letter typed into a tag of its own.
    peek: () => tags.slice(),
    // Called when the category changes, so the suggestion order follows it too.
    reorder: (list) => { suggestions = list; drawSuggest(); },
  };
}

// Tags on an entry row, read-only. A legacy note rides alongside rather than
// being converted: a sentence is not a tag, and guessing which words in it were
// meant as one would put words in the user's mouth.
export function tagRow(rec) {
  const tags = tagsOf(rec);
  if (!tags.length) return null;
  return el('div', { class: 'tag-row' }, tags.map((t) => el('span', { class: 'tag-pill', text: t })));
}

// ---------- Entries filter, shared by both trackers ----------
//
// All, then each way of paying that this month actually used, then the cards.
//
// "Cards" is a way of paying, exactly like UPI: every entry that went on a
// card, whichever card that was. The individual cards sit after it as a way of
// narrowing further, not as the only way in - a card spend saved without a
// card picked belongs under Cards with the rest of them, not hidden until you
// think to press All.
//
// Only options with rows BEHIND them are offered. A chip that filters to
// nothing is a dead control, and going by what the month holds also means an
// unused - or deleted - card drops out on its own, with no separate cleanup.
// By the same rule the per-card chips only appear once there is more than one
// card bucket to tell apart: with everything on a single card, "Cards" already
// selects exactly that, and a second chip selecting the same rows is noise.
const SPEND_FILTER_ALL = 'all';
export function spendEntryFilter(rows, cards, current, onPick) {
  const has = (fn) => (rows || []).some(fn);
  const opts = [[SPEND_FILTER_ALL, 'All']];
  SPEND_METHODS.forEach((mth) => {
    if (mth !== 'Card' && has((r) => r.method === mth)) opts.push(['m:' + mth, mth]);
  });
  if (has((r) => r.method === 'Card')) {
    opts.push(['m:Card', 'Cards']);
    // Buckets, not cards: an entry with no card named is its own bucket, since
    // telling it apart from a named card is exactly what the chips are for.
    const buckets = new Set((rows || [])
      .filter((r) => r.method === 'Card')
      .map((r) => (r.cardId == null ? 'none' : String(r.cardId))));
    if (buckets.size > 1) {
      (cards || []).forEach((c) => {
        if (buckets.has(String(c.id))) opts.push(['card:' + c.id, c.name || 'Card']);
      });
      if (buckets.has('none')) opts.push(['card:none', 'No card']);
    }
  }
  const cur = opts.some(([v]) => v === current) ? current : SPEND_FILTER_ALL;
  const matches = (r) => {
    if (cur === SPEND_FILTER_ALL) return true;
    if (cur.slice(0, 2) === 'm:') return r.method === cur.slice(2);
    const want = cur.slice(5);
    if (r.method !== 'Card') return false;
    return want === 'none' ? r.cardId == null : String(r.cardId) === want;
  };
  // Nothing to filter by when every entry in the month is the same thing.
  const node = opts.length > 1
    ? el('div', { class: 'pf-filter' }, opts.map(([v, label]) => el('button', {
        type: 'button', class: 'pf-filter-chip' + (v === cur ? ' active' : ''), text: label,
        onclick: () => { if (v === cur) return; onPick(v); },
      })))
    : null;
  return { node, matches, current: cur, label: (opts.find(([v]) => v === cur) || [null, 'All'])[1] };
}

// The line under the chips: what the filter is showing. The figures above an
// entries list are the whole month's, so without this the two look as though
// they disagree.
export function spendFilterNote(f, shown, extra) {
  if (f.current === SPEND_FILTER_ALL) return null;
  const sum = round2((shown || []).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const bits = [f.label + ' · ' + fmtSheetCur(sum) + ' · '
    + shown.length + (shown.length === 1 ? ' entry' : ' entries')];
  if (extra) bits.push(extra);
  return el('p', { class: 'hint pf-filter-note', text: bits.join('  ·  ') });
}
