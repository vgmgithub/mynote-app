// Medicine Cabinet screen (the "Medicines" tab inside Health Check). The rules live in medicine.js; this file only
// draws them and saves the records. One list for the household; a medicine can be tagged to a Health Check person.
import { DB } from './db.js';
import { el, toast, openModal, closeModal, field, appConfirm, formSection } from './app.js';
import { todayISO } from './core.js';
import { medTypeSvg, medActionSvg } from './medicine-icons.js';
import { MED_TYPES, MED_PURPOSES, MED_TIMES, normaliseWhen, normaliseWhenNote, normaliseCures, rankCures, cureCatalog, MED_SOON_DAYS, DISPOSE_TIP, medStatus, comingUp, sortByExpiry, restockCopy, expiryLabel, expiryEnd, statusText } from './medicine.js';

// Which list is showing (All / Reminder / Past) and the search text - kept while the person moves around.
let _medView = 'all';
let _medSearch = '';

const isClosed = (m) => m.status === 'used' || m.status === 'disposed';
// A medicine's type as its drawing (medicine-icons.js): the same picture on the type tiles, the form and the cards.
const typeIcon = (type, cls) => { const s = el('span', { class: 'med-type-ico ' + (cls || '') }); s.innerHTML = medTypeSvg(type); return s; };
// When in the day, with the look each one has on a card and in the form.
// A rising sun behind two mountains, drawn on its own (no sky) for the list's When badge.
const SUNRISE_SVG = '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true"><path d="M7 14a5 5 0 0 1 10 0z" fill="#fbbf24"/><path d="M12 4.5v2M5.6 7.2l1.3 1.3M18.4 7.2l-1.3 1.3M2.8 12.5h1.8M19.4 12.5h1.8" stroke="#f59e0b" stroke-width="1.4" stroke-linecap="round" fill="none"/><path d="M1.5 20l6.5-9 4.5 6.2L15.5 13l7 7z" fill="#64748b"/><path d="M8 11l1.7 2.3-1.7-.6-1.5.9z" fill="#e2e8f0"/></svg>';
const TIME_ICON = { morning: '🌅', afternoon: '☀️', night: '🌙' };
const timeLabel = (id) => (MED_TIMES.find(([k]) => k === id) || [id, id])[1];
// When in the day, as ONE badge holding all three symbols: the times the medicine is for in colour, the others in black and
// white. Nothing at all when no time is set.
const whenBadge = (when) => {
  const on = new Set(normaliseWhen(when));
  if (!on.size) return null;
  return el('span', { class: 'med-when-badge', title: normaliseWhen(when).map(timeLabel).join(' \u00b7 '), 'aria-label': 'Take in the ' + normaliseWhen(when).map(timeLabel).join(' and ').toLowerCase() },
    MED_TIMES.map(([id]) => {
      const sym = el('span', { class: 'mwb-sym ' + (on.has(id) ? 'on' : 'off') });
      if (id === 'morning') sym.innerHTML = SUNRISE_SVG; else sym.textContent = TIME_ICON[id];
      return sym;
    }));
};
const whenChips = (when, note) => [whenBadge(when)].filter(Boolean)
  .concat(normaliseWhenNote(note) ? [el('span', { class: 'med-when-chip is-custom', title: normaliseWhenNote(note) }, [el('span', { text: '\u270F\uFE0F' }), document.createTextNode(normaliseWhenNote(note))])] : []);
const hasWhen = (m) => normaliseWhen(m.when).length > 0 || !!normaliseWhenNote(m.whenNote);

export async function renderMedicineCabinet(host, ctx) {
  const people = (ctx && ctx.people) || [];
  const rerender = (ctx && ctx.rerender) || (() => {});
  const meds = await DB.all('medicines').catch(() => []);
  const today = todayISO();
  const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? p.name : null; };

  const active = meds.filter((m) => !isClosed(m));
  const closed = meds.filter(isClosed).sort((a, b) => String(b.closedOn || '').localeCompare(String(a.closedOn || '')));
  const soon = comingUp(active, today);
  const nExpired = soon.filter((m) => m._status.state === 'expired').length;
  const nSoon = soon.length - nExpired;

  // ---- Head: what is in the cabinet, and what needs doing ----
  host.appendChild(el('div', { class: 'med-head' }, [
    el('div', { class: 'med-head-title' }, [el('span', { class: 'med-head-ico', text: '💊' }), 'Medicine Cabinet']),
    el('div', { class: 'med-head-sub', text: active.length ? active.length + (active.length === 1 ? ' medicine' : ' medicines') + ' at home' : 'Nothing noted yet' }),
    (nExpired || nSoon) ? el('div', { class: 'med-head-badges' }, [
      nExpired ? el('span', { class: 'med-badge is-expired', text: nExpired + ' expired' }) : null,
      nSoon ? el('span', { class: 'med-badge is-soon', text: nSoon + ' expiring soon' }) : null,
    ].filter(Boolean)) : null,
  ].filter(Boolean)));

  if (!meds.length) {
    host.appendChild(el('div', { class: 'hc-empty' }, [
      el('div', { text: 'Note down the medicines at home - expiry, type, what each is for and how to take it.' }),
      el('div', { class: 'med-empty-sub', text: 'Anything expiring within ' + MED_SOON_DAYS + ' days shows under Reminder, so you can buy a fresh pack in time and throw the old one away safely.' }),
      el('button', { class: 'hc-empty-cta', text: '+ Add medicine', onclick: () => openMedicineForm(null, { people, rerender }) }),
    ]));
    return;
  }

  // ---- Which list, and search ----
  const chip = (v, label, n) => el('button', {
    type: 'button', class: 'pf-filter-chip' + (_medView === v ? ' active' : ''),
    onclick: () => { if (_medView === v) return; _medView = v; rerender(); },
  }, [label + (n ? ' · ' + n : '')]);
  host.appendChild(el('div', { class: 'pf-filter med-filter' }, [
    chip('all', 'All', active.length), chip('soon', 'Reminder', soon.length), chip('past', 'Used up / disposed', closed.length),
  ]));
  const search = el('input', { type: 'search', class: 'med-search', placeholder: 'Search a cure, name, purpose or use', value: _medSearch });
  host.appendChild(search);
  const listHost = el('div', {});
  host.appendChild(listHost);

  const matches = (m) => {
    const q = _medSearch.trim().toLowerCase();
    if (!q) return true;
    return [m.name, m.purpose, m.type, m.usage, nameOf(m.personId), normaliseWhen(m.when).map(timeLabel).join(' '), normaliseWhenNote(m.whenNote), normaliseCures(m.cures).join(' ')]
      .some((x) => String(x || '').toLowerCase().includes(q));
  };

  // What it cures stays behind this button (tap to see them all). While a search names one of its cures, the button
  // says which, so it is plain why the medicine is listed.
  const cureButton = (m) => {
    const cures = normaliseCures(m.cures);
    if (!cures.length) return null;
    const q = _medSearch.trim().toLowerCase();
    const hit = q ? cures.find((c) => c.toLowerCase().includes(q)) : null;
    return el('button', { type: 'button', class: 'med-cure-btn' + (hit ? ' is-match' : ''), 'aria-label': 'What ' + (m.name || 'it') + ' cures',
      onclick: (e) => { e.stopPropagation(); openCureSheet(m); } }, [
      el('span', { class: 'med-cure-i', text: 'i' }), document.createTextNode(hit ? 'Cures ' + hit : 'Cures'),
    ]);
  };

  const card = (m, opts) => {
    const s = m._status || medStatus(m, today);
    const who = m.personId != null ? nameOf(m.personId) : null;
    const cureBtn = cureButton(m);
    const actions = [];
    if (opts && opts.actions) {
      actions.push(el('button', { type: 'button', class: 'med-act is-buy', onclick: (e) => { e.stopPropagation(); openMedicineForm(null, { people, rerender, restockOf: m }); } },
        [el('span', { class: 'med-act-plus', text: '+' }), 'Buy again']));
      if (s.state === 'expired') {
        actions.push(el('button', { type: 'button', class: 'med-act is-dispose', onclick: async (e) => { e.stopPropagation(); if (await disposeMedicine(m)) rerender(); } }, ['🗑️ Dispose']));
      }
    }
    // An expired pack only needs replacing or throwing away: no How to use or When badge, the Buy again / Dispose
    // buttons take that place, and the status badge itself carries the month it expired.
    const expired = s.state === 'expired' && !isClosed(m);
    return el('div', { class: 'med-card is-' + s.state, role: 'button', tabindex: '0', onclick: () => openMedicineForm(m, { people, rerender }) }, [
      el('div', { class: 'med-row' }, [
        typeIcon(m.type, 'med-ico'),
        el('div', { class: 'med-main' }, [
          // The purpose (Eye, Ear...) sits beside the name; the line below keeps only when to take it (and for whom).
          el('div', { class: 'med-name-row' }, [
            el('span', { class: 'med-name', text: m.name || 'Medicine' }),
            m.purpose ? el('span', { class: 'med-tag is-purpose', text: m.purpose }) : null,
          ].filter(Boolean)),
          // Expired: Buy again / Dispose (small) right under the name, the Cures badge at the right end of that row.
          expired && actions.length ? el('div', { class: 'med-acts is-compact' }, actions.concat(cureBtn ? [cureBtn] : [])) : null,
          // One line, scrolled sideways when it is longer than the card. No type tag: the drawing beside the name is the type.
          el('div', { class: 'med-tags' }, [
            ...(expired ? [] : whenChips(m.when, m.whenNote)),
            who ? el('span', { class: 'med-tag is-who', text: who }) : null,
          ].filter(Boolean)),
        ].filter(Boolean)),
        el('div', { class: 'med-exp' }, [
          expired ? null : el('span', { class: 'med-exp-date', text: isClosed(m) ? (m.closedOn ? 'on ' + m.closedOn.split('-').reverse().join('/') : '') : 'Exp ' + expiryLabel(m.expiry) }),
          el('span', { class: 'med-status is-' + s.state, text: expired && m.expiry ? 'Expired - ' + expiryLabel(m.expiry) : statusText(s) }),
        ].filter(Boolean)),
      ]),
      // "How to use" with the small "Cures i" badge on the same line, at its right end.
      !expired && (m.usage || cureBtn) ? el('div', { class: 'med-usage-row' }, [
        m.usage ? el('div', { class: 'med-usage' }, [el('b', { text: 'How to use: ' }), document.createTextNode(m.usage)]) : null,
        cureBtn,
      ].filter(Boolean)) : null,
      !expired && actions.length ? el('div', { class: 'med-acts' }, actions) : null,
    ].filter(Boolean));
  };

  const draw = () => {
    listHost.innerHTML = '';
    if (_medView === 'past') {
      const rows = closed.filter(matches);
      if (!rows.length) { listHost.appendChild(el('div', { class: 'hc-empty', text: _medSearch ? 'Nothing matches.' : 'Nothing used up or disposed yet.' })); return; }
      rows.forEach((m) => listHost.appendChild(card(m, { actions: true })));
      return;
    }
    const up = soon.filter(matches);
    if (up.length) {
      listHost.appendChild(el('div', { class: 'med-sec' }, [
        el('div', { class: 'med-sec-head' }, [el('span', { text: '⏰ Reminder' }), el('span', { class: 'med-sec-hint', text: 'buy again before it runs out of date' })]),
        ...up.map((m) => card(m, { actions: true })),
      ]));
      if (up.some((m) => m._status.state === 'expired')) listHost.appendChild(el('p', { class: 'hint med-tip' }, [el('b', { text: 'Disposing safely: ' }), document.createTextNode(DISPOSE_TIP)]));
    } else if (_medView === 'soon') {
      listHost.appendChild(el('div', { class: 'hc-empty', text: _medSearch ? 'Nothing matches.' : 'Nothing expires in the next ' + MED_SOON_DAYS + ' days.' }));
    }
    if (_medView === 'soon') return;
    const soonIds = new Set(soon.map((m) => m.id));
    const rest = sortByExpiry(active.filter((m) => !soonIds.has(m.id))).filter(matches);
    if (rest.length) {
      listHost.appendChild(el('div', { class: 'med-sec' }, [
        el('div', { class: 'med-sec-head' }, [el('span', { text: '🏠 In the cabinet' }), el('span', { class: 'med-sec-hint', text: 'soonest expiry first' })]),
        ...rest.map((m) => card(m)),
      ]));
    } else if (!up.length) {
      listHost.appendChild(el('div', { class: 'hc-empty', text: _medSearch ? 'Nothing matches.' : 'Everything here is used up or disposed.' }));
    }
  };
  search.addEventListener('input', () => { _medSearch = search.value; draw(); });
  draw();
}

// What a medicine cures, from its card's "Cures" button - with how and when it is taken, for context.
function openCureSheet(m) {
  openModal(el('div', { class: 'sheet med-cure-sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'med-cure-head' }, [
        typeIcon(m.type, 'medf-head-ico'),
        el('div', {}, [el('h2', { text: m.name || 'Medicine' }), el('p', { class: 'medf-head-sub', text: 'What it cures' })]),
      ]),
      el('div', { class: 'med-cure-list' }, normaliseCures(m.cures).map((c) => el('span', { class: 'med-cure-chip', text: c }))),
      hasWhen(m) ? el('div', { class: 'med-when' }, whenChips(m.when, m.whenNote)) : null,
      m.usage ? el('p', { class: 'med-cure-usage' }, [el('b', { text: 'How to use: ' }), document.createTextNode(m.usage)]) : null,
      el('button', { class: 'btn ghost info-close', type: 'button', text: 'Close', onclick: closeModal }),
    ].filter(Boolean)),
  ]));
}

async function disposeMedicine(m) {
  if (!(await appConfirm('Mark ' + (m.name || 'this medicine') + ' as disposed? ' + DISPOSE_TIP, { okText: 'Disposed', danger: false }))) return false;
  await DB.put('medicines', Object.assign({}, m, { status: 'disposed', closedOn: todayISO(), updatedAt: new Date().toISOString() }));
  delete (m)._status;
  toast('Disposed. Tap + Buy again on it under Used up / disposed if you still need it.');
  return true;
}

// ---------- Add / edit / buy again ----------
// One sheet - what it is, how to take it and when, for whom, and the pack - with taps instead of typing wherever
// the choice is fixed: type tiles (each its own drawing), purpose chips, Morning / Afternoon / Night, the expiry
// as the month and year printed on the pack (with +6 months / +1 / +2 / +3 years), and a live line that says how
// long the pack is good for. A name already in the cabinet fills in its type, purpose, use and times.
const TYPE_SHORT = { 'Cream / ointment': 'Cream', 'Powder / sachet': 'Powder' };
const PURPOSE_ICON = { Fever: '🌡️', Pain: '🤕', 'Cold / cough': '🤧', Stomach: '🤢', Allergy: '🌾', Eye: '👁️', Ear: '👂', Nose: '👃', Mouth: '👄', Tooth: '🦷', Wound: '🩹', 'First aid': '🧰', Infection: '🦠', Breathing: '🫁', 'Bones / joints': '🦴', Heart: '❤️',
  'Women\u2019s health': '🌸', 'Baby care': '👶', Sleep: '😴', Skin: '🖐️', 'BP / sugar': '🩸', Vitamins: '🍊', Other: '➕' };
const MONS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + ' ' + MONS_SHORT[+m[2] - 1] + ' ' + m[1] : ''; };
const isYmStr = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const goodFor = (days) => {
  const months = Math.round(days / 30.44);
  if (months < 1) return 'under a month';
  if (months < 12) return months + (months === 1 ? ' month' : ' months');
  const y = Math.floor(months / 12), m = months % 12;
  return y + (y === 1 ? ' year' : ' years') + (m ? ' ' + m + (m === 1 ? ' month' : ' months') : '');
};

// A row of buttons that behaves like one choice. `allowNone`: a second tap on the chosen one clears it.
function pickGroup(options, value, cls, allowNone, onChange) {
  let cur = value || '';
  const wrap = el('div', { class: 'medf-pick ' + (cls || ''), role: 'radiogroup' });
  const btns = options.map((op) => {
    const b = el('button', { type: 'button', class: 'medf-opt', role: 'radio', onclick: () => { cur = allowNone && cur === op.value ? '' : op.value; sync(); if (onChange) onChange(cur); } },
      [op.iconEl ? op.iconEl() : op.icon ? el('span', { class: 'medf-opt-ico', text: op.icon }) : null, el('span', { class: 'medf-opt-txt', text: op.label })].filter(Boolean));
    b._v = op.value;
    wrap.appendChild(b);
    return b;
  });
  const sync = () => btns.forEach((b) => { const on = b._v === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  sync();
  return { node: wrap, get value() { return cur; }, set(v) { cur = v || ''; sync(); if (onChange) onChange(cur); } };
}
const withExtra = (list, value) => (value && !list.includes(value) ? list.concat([value]) : list);

export async function openMedicineForm(existing, o) {
  const opts = o || {};
  const people = opts.people || [];
  const rerender = opts.rerender || (() => {});
  const base = existing || (opts.restockOf ? restockCopy(opts.restockOf) : {});
  const isEdit = !!existing;
  const today = todayISO();
  const cabinet = await DB.all('medicines').catch(() => []);

  // ---- What it is ----
  const listId = 'medNames' + Date.now();
  const name = el('input', { type: 'text', class: 'medf-name', placeholder: 'e.g. Paracetamol 650', value: base.name || '', list: listId, autocomplete: 'off' });
  const names = [...new Set(cabinet.map((m) => String(m.name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const datalist = el('datalist', { id: listId }, names.map((n) => el('option', { value: n })));
  const nameHint = el('div', { class: 'medf-hint hidden' });
  const type = pickGroup(withExtra(MED_TYPES, base.type).map((t) => ({ value: t, label: TYPE_SHORT[t] || t, iconEl: () => typeIcon(t, 'medf-opt-ico') })), base.type, 'is-tiles', true, () => drawCureSugg());
  const purpose = pickGroup(withExtra(MED_PURPOSES, base.purpose).map((p) => ({ value: p, label: p, icon: PURPOSE_ICON[p] || '•' })), base.purpose, 'is-chips', true, () => drawCureSugg());

  // ---- What it cures: tags. Tap a suggestion or type one (Enter adds it); the suggestions sit on one line that
  // scrolls sideways, the ones that go with the chosen type (and purpose) first. ----
  const cures = normaliseCures(base.cures);
  // Every cure on the shelf, the ones typed on other medicines included, each remembering what it was used with.
  const catalog = cureCatalog(cabinet);
  const cureInput = el('input', { type: 'text', class: 'medf-cure-input', enterkeyhint: 'done', autocomplete: 'off', 'aria-label': 'What it cures' });
  const cureBox = el('div', { class: 'medf-cures', onclick: (e) => { if (e.target === cureBox) cureInput.focus(); } });
  const cureSugg = el('div', { class: 'medf-cure-sugg' });
  function drawCureSugg() {
    if (!cureSugg) return;
    cureSugg.innerHTML = '';
    const q = cureInput.value.trim().toLowerCase();
    const list = rankCures(type ? type.value : base.type, purpose ? purpose.value : base.purpose, cures, catalog).filter((t) => !q || t.toLowerCase().includes(q));
    list.forEach((t) => cureSugg.appendChild(el('button', { type: 'button', class: 'medf-cure-s', onclick: () => addCure(t) }, ['+ ' + t])));
    cureSugg.scrollLeft = 0;
  }
  const drawCures = () => {
    cureBox.innerHTML = '';
    cures.forEach((c, i) => cureBox.appendChild(el('span', { class: 'medf-cure-chip' }, [
      document.createTextNode(c),
      el('button', { type: 'button', class: 'medf-cure-x', 'aria-label': 'Remove ' + c, text: '×', onclick: () => { cures.splice(i, 1); drawCures(); } }),
    ])));
    cureInput.placeholder = cures.length ? 'Add another' : 'e.g. Headache - type, or tap one below';
    cureBox.appendChild(cureInput);
    drawCureSugg();
  };
  const addCure = (t) => {
    const next = normaliseCures(cures.concat([t]));
    if (next.length === cures.length) { if (cures.length >= 8) toast('Up to 8 cures'); cureInput.value = ''; drawCures(); return; }
    cures.splice(0, cures.length, ...next);
    cureInput.value = '';
    drawCures();
    cureInput.focus();
  };
  cureInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (cureInput.value.trim()) addCure(cureInput.value); }
    else if (e.key === 'Backspace' && !cureInput.value && cures.length) { cures.pop(); drawCures(); cureInput.focus(); }
  });
  cureInput.addEventListener('input', drawCureSugg);
  drawCures();

  // ---- How to use ----
  const usage = el('textarea', { rows: '3', class: 'medf-usage', placeholder: 'Dose and how to take it - e.g. 1 tablet after food, or 10 ml with water' });
  usage.value = base.usage || '';
  // When to use: Morning / Afternoon / Night, any of them, and a 4th, Custom, whose text box (below) holds anything
  // else - "before breakfast", "every 6 hours". What is picked shows on the medicine's card.
  const whenSel = new Set(normaliseWhen(base.when));
  let customOn = !!normaliseWhenNote(base.whenNote);
  const whenNote = el('input', { type: 'text', class: 'medf-when-note', maxlength: '100', autocomplete: 'off', enterkeyhint: 'done',
    placeholder: 'e.g. Before breakfast, every 6 hours, only when needed', 'aria-label': 'When to use - your own note', value: normaliseWhenNote(base.whenNote) });
  const noteWrap = el('div', { class: 'medf-when-note-wrap hidden' }, [whenNote]);
  const customBtn = el('button', { type: 'button', class: 'medf-time is-custom', 'aria-pressed': 'false', onclick: () => {
    customOn = !customOn; syncWhen(); if (customOn) whenNote.focus();
  } }, [el('span', { class: 'medf-time-ico', text: '\u270F\uFE0F' }), el('span', { class: 'medf-time-txt', text: 'Custom' }), el('span', { class: 'medf-time-tick', text: '\u2713' })]);
  const whenBtns = MED_TIMES.map(([id, label]) => {
    const b = el('button', { type: 'button', class: 'medf-time is-' + id, 'aria-pressed': 'false', onclick: () => { if (whenSel.has(id)) whenSel.delete(id); else whenSel.add(id); syncWhen(); } }, [
      el('span', { class: 'medf-time-ico', text: TIME_ICON[id] }), el('span', { class: 'medf-time-txt', text: label }), el('span', { class: 'medf-time-tick', text: '✓' }),
    ]);
    b._id = id;
    return b;
  });
  const syncWhen = () => {
    whenBtns.forEach((b) => { const on = whenSel.has(b._id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    customBtn.classList.toggle('on', customOn); customBtn.setAttribute('aria-pressed', String(customOn));
    noteWrap.classList.toggle('hidden', !customOn);
  };
  syncWhen();
  // One line of four options, scrolling sideways on a narrow phone; the note's box opens under it.
  const whenRow = el('div', { class: 'medf-when' }, [el('div', { class: 'medf-when-label', text: 'When to use' }), el('div', { class: 'medf-times' }, whenBtns.concat([customBtn])), noteWrap]);

  // ---- For whom ----
  const whoStart = base.personId != null && people.some((p) => p.id === base.personId) ? String(base.personId) : '';
  const who = pickGroup([{ value: '', label: 'Household', icon: '🏠' }].concat(people.map((p) => ({ value: String(p.id), label: p.name, icon: '👤' }))), whoStart, 'is-chips is-scroll', false);

  // A name already in the cabinet: fill what is still blank from its latest pack.
  name.addEventListener('change', () => {
    if (isEdit) return;
    const key = name.value.trim().toLowerCase();
    const prev = cabinet.filter((m) => String(m.name || '').trim().toLowerCase() === key)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    if (!prev) { nameHint.classList.add('hidden'); return; }
    let filled = 0;
    if (!type.value && prev.type) { type.set(prev.type); filled++; }
    if (!purpose.value && prev.purpose) { purpose.set(prev.purpose); filled++; }
    if (!usage.value.trim() && prev.usage) { usage.value = prev.usage; filled++; }
    if (!whenSel.size && normaliseWhen(prev.when).length) { normaliseWhen(prev.when).forEach((id) => whenSel.add(id)); syncWhen(); filled++; }
    if (!customOn && !whenNote.value.trim() && normaliseWhenNote(prev.whenNote)) { whenNote.value = normaliseWhenNote(prev.whenNote); customOn = true; syncWhen(); filled++; }
    if (!cures.length && normaliseCures(prev.cures).length) { cures.push(...normaliseCures(prev.cures)); drawCures(); filled++; }
    if (!who.value && prev.personId != null && people.some((p) => p.id === prev.personId)) { who.set(String(prev.personId)); filled++; }
    nameHint.textContent = filled ? 'Filled in from the pack you noted before - change anything that is different.' : '';
    nameHint.classList.toggle('hidden', !filled);
  });

  // ---- The pack ----
  const nowD = new Date(), cy = nowD.getFullYear();
  const startY = isYmStr(base.expiry) ? Number(base.expiry.slice(0, 4)) : null;
  const years = []; for (let y = cy - 2; y <= cy + 8; y++) years.push(y);
  if (startY && !years.includes(startY)) { years.push(startY); years.sort((a, b) => a - b); }
  const mon = el('select', { 'aria-label': 'Expiry month' }, [el('option', { value: '', text: 'Month' }), ...MONS_SHORT.map((m, i) => el('option', { value: String(i + 1).padStart(2, '0'), text: m }))]);
  const year = el('select', { 'aria-label': 'Expiry year' }, [el('option', { value: '', text: 'Year' }), ...years.map((y) => el('option', { value: String(y), text: String(y) }))]);
  mon.value = isYmStr(base.expiry) ? base.expiry.slice(5, 7) : '';
  year.value = startY ? String(startY) : '';
  const expiryValue = () => (mon.value && year.value ? year.value + '-' + mon.value : '');
  const expStatus = el('div', { class: 'medf-exp-status' });
  const showExp = () => {
    const v = expiryValue();
    if (!v) { expStatus.className = 'medf-exp-status'; expStatus.textContent = 'Pick the month and year printed after EXP on the pack.'; return; }
    const s = medStatus({ expiry: v }, today), end = dayLabel(expiryEnd(v));
    expStatus.className = 'medf-exp-status is-' + s.state;
    expStatus.textContent = s.state === 'expired' ? '✕ Already expired (' + end + ') - note it, then dispose of it.'
      : s.state === 'soon' ? '⚠ Expires ' + (s.days === 0 ? 'today' : 'in ' + s.days + (s.days === 1 ? ' day' : ' days')) + ' (' + end + ') - it will show under Reminder.'
        : '✓ Good for about ' + goodFor(s.days) + ' - until ' + end + '.';
  };
  mon.addEventListener('change', showExp); year.addEventListener('change', showExp);
  const quickExp = el('div', { class: 'medf-quick' }, [['+6 months', 6], ['+1 year', 12], ['+2 years', 24], ['+3 years', 36]].map(([label, n]) => el('button', {
    type: 'button', class: 'medf-qchip', text: label, onclick: () => {
      const d = new Date(cy, nowD.getMonth() + n, 1);
      if (!years.includes(d.getFullYear())) year.appendChild(el('option', { value: String(d.getFullYear()), text: String(d.getFullYear()) }));
      mon.value = String(d.getMonth() + 1).padStart(2, '0'); year.value = String(d.getFullYear()); showExp();
    },
  })));
  showExp();
  const bought = el('input', { type: 'date', value: base.boughtOn || (isEdit ? '' : today) });

  // Buying again: the old pack can be disposed of in the same step - switched on when it has already expired.
  let disposeOld = null, restockNote = null;
  if (opts.restockOf) {
    const old = opts.restockOf, os = medStatus(old, today);
    restockNote = el('div', { class: 'medf-restock' }, [
      el('span', { class: 'medf-restock-ico', text: '🔁' }),
      el('span', {}, [document.createTextNode('A fresh pack of '), el('b', { text: old.name || 'this medicine' }),
        document.createTextNode(' · the old one ' + (os.state === 'expired' ? 'expired ' : 'expires ') + expiryLabel(old.expiry))]),
    ]);
    if (!isClosed(old)) {
      disposeOld = el('input', { type: 'checkbox' });
      disposeOld.checked = os.state === 'expired';
    }
  }

  const save = async () => {
    // A cure typed but not yet added with Enter still counts.
    if (cureInput.value.trim()) addCure(cureInput.value);
    const n = name.value.trim();
    if (!n) { toast('Add the medicine name'); name.focus(); return; }
    const expiry = expiryValue();
    if (!expiry) { toast('Pick the expiry month and year from the pack'); (mon.value ? year : mon).focus(); return; }
    const now = new Date().toISOString();
    const rec = Object.assign({}, existing || {}, {
      name: n.slice(0, 80), type: type.value, purpose: purpose.value, usage: usage.value.trim().slice(0, 500), when: normaliseWhen([...whenSel]), whenNote: customOn ? normaliseWhenNote(whenNote.value) : '', cures: normaliseCures(cures),
      personId: who.value ? Number(who.value) : null, expiry, boughtOn: bought.value || '',
      status: (existing && existing.status) || 'active', closedOn: (existing && existing.closedOn) || null,
      updatedAt: now,
    });
    if (!isEdit) rec.createdAt = now;
    delete rec._status;
    await DB.put('medicines', rec);
    if (disposeOld && disposeOld.checked) {
      const old = Object.assign({}, opts.restockOf, { status: 'disposed', closedOn: today, updatedAt: now });
      delete old._status;
      await DB.put('medicines', old);
    }
    closeModal();
    toast(isEdit ? 'Medicine updated' : opts.restockOf ? 'New pack added' + (disposeOld && disposeOld.checked ? ', old one disposed' : '') : 'Medicine added');
    rerender();
  };
  const close = async (status) => {
    if (status === 'disposed') { if (!(await disposeMedicine(existing))) return; }
    else await DB.put('medicines', Object.assign({}, existing, { status, closedOn: status === 'active' ? null : today, updatedAt: new Date().toISOString() }));
    closeModal();
    if (status === 'used') toast('Marked used up');
    if (status === 'active') toast('Back in the cabinet');
    rerender();
  };
  const del = async () => {
    if (!(await appConfirm('Delete ' + (existing.name || 'this medicine') + ' for good?'))) return;
    await DB.del('medicines', existing.id);
    closeModal(); toast('Removed'); rerender();
  };

  const title = isEdit ? 'Edit medicine' : opts.restockOf ? 'Buy again' : 'Add medicine';
  const sub = isEdit ? statusText(medStatus(existing, today)) + (existing.expiry ? ' · exp ' + expiryLabel(existing.expiry) : '')
    : opts.restockOf ? 'Same medicine, new pack - just set its expiry.' : 'Note it once; Reminder tells you before it expires.';
  const sec = (node) => { node.classList.add('medf-sec'); return node; };
  // Save, Cancel, Used up, Dispose and Delete as icon buttons on one line (the name is the label and the tooltip).
  // Each is a round icon with its name in a small rounded label beneath, so nobody has to guess what an icon does.
  let capSeq = 0;
  const CAPTION = { save: 'Save', cancel: 'Cancel', used: 'Used up', dispose: 'Dispose', delete: 'Delete', back: 'Back' };
  const ibtn = (kind, icon, label, onclick) => {
    const b = el('button', { type: 'button', class: 'medf-ibtn is-' + kind, 'aria-label': label, title: label, onclick });
    b.innerHTML = medActionSvg(icon);
    // The name curves under the button like a smile: white bold text on an arc, no badge.
    const id = 'medcap' + (++capSeq), txt = CAPTION[kind] || label;
    const cap = el('span', { class: 'medf-ib-cap' });
    cap.innerHTML = '<svg viewBox="0 0 72 20" width="72" height="20" aria-hidden="true"><path id="' + id + '" d="M6 3Q36 19 66 3" fill="none"/><text><textPath href="#' + id + '" startOffset="50%" text-anchor="middle">' + txt + '</textPath></text></svg>';
    cap.setAttribute('aria-label', txt);
    return el('div', { class: 'medf-ib is-' + kind }, [b, cap]);
  };
  const bar = [ibtn('save', 'save', isEdit ? 'Save changes' : opts.restockOf ? 'Add new pack' : 'Save medicine', save), ibtn('cancel', 'cancel', 'Cancel', closeModal)];
  if (isEdit && !isClosed(existing)) {
    bar.push(ibtn('used', 'used', 'Used up', () => close('used')));
    bar.push(ibtn('dispose', 'dispose', 'Dispose', () => close('disposed')));
  }
  if (isEdit && isClosed(existing)) bar.push(ibtn('back', 'back', 'Back in the cabinet', () => close('active')));
  if (isEdit) bar.push(ibtn('delete', 'delete', 'Delete', del));

  openModal(el('div', { class: 'sheet has-fixed-footer medf' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'medf-head' }, [
        el('div', { class: 'medf-head-text' }, [el('h2', { text: title }), el('p', { class: 'medf-head-sub', text: sub })]),
      ]),
      restockNote,
      el('div', { class: 'form-sec medf-sec' }, [
        field('Name', el('div', {}, [name, datalist, nameHint])),
        field('Type', type.node),
        field('What is it for?', purpose.node),
        field('Cures', el('div', {}, [cureBox, cureSugg])),
      ]),
      // How to use, when to use it, and for whom - one section, the badges for whom below the rest.
      sec(formSection('🕒', 'How to use', [usage, whenRow, el('div', { class: 'medf-when medf-who' }, [el('div', { class: 'medf-when-label', text: 'For whom' }), who.node])])),
      // The pack (expiry and purchase) needs no heading of its own: it is the last section, set apart by the line above.
      el('div', { class: 'form-sec medf-sec' }, [
        // Bought on the left half, expiry (month and year) on the right.
        el('div', { class: 'medf-pack-row' }, [field('Bought on', bought), field('Expiry (EXP)', el('div', { class: 'medf-exp-row' }, [mon, year]))]),
        quickExp,
        expStatus,
        disposeOld ? el('label', { class: 'medf-toggle' }, [disposeOld, el('span', { class: 'medf-toggle-text' }, [
          el('b', { text: 'Dispose of the old pack' }),
          el('small', { text: 'Marks it disposed today, so it leaves Reminder.' }),
        ])]) : null,
      ].filter(Boolean)),
    ].filter(Boolean)),
    el('div', { class: 'sheet-footer medf-iconbar' }, bar),
  ]));
  if (!isEdit && !opts.restockOf) setTimeout(() => name.focus(), 60);
}
