// Medicine Cabinet screen (the "Medicines" tab inside Health Check). The rules live in medicine.js; this file only
// draws them and saves the records. One list for the household; a medicine can be tagged to a Health Check person.
import { DB } from './db.js';
import { el, toast, openModal, closeModal, field, appConfirm, formSection } from './app.js';
import { todayISO } from './core.js';
import { medTypeSvg } from './medicine-icons.js';
import { MED_TYPES, MED_PURPOSES, MED_TIMES, normaliseWhen, MED_SOON_DAYS, DISPOSE_TIP, medStatus, comingUp, sortByExpiry, restockCopy, expiryLabel, expiryEnd, statusText } from './medicine.js';

// Which list is showing (All / Coming up / Past) and the search text - kept while the person moves around.
let _medView = 'all';
let _medSearch = '';

const isClosed = (m) => m.status === 'used' || m.status === 'disposed';
// A medicine's type as its drawing (medicine-icons.js): the same picture on the type tiles, the form and the cards.
const typeIcon = (type, cls) => { const s = el('span', { class: 'med-type-ico ' + (cls || '') }); s.innerHTML = medTypeSvg(type); return s; };
// When in the day, with the look each one has on a card and in the form.
const TIME_ICON = { morning: '🌅', afternoon: '☀️', night: '🌙' };
const timeLabel = (id) => (MED_TIMES.find(([k]) => k === id) || [id, id])[1];
const whenChips = (when) => normaliseWhen(when).map((id) => el('span', { class: 'med-when-chip is-' + id }, [el('span', { text: TIME_ICON[id] }), document.createTextNode(timeLabel(id))]));

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
      el('div', { class: 'med-empty-sub', text: 'Anything expiring within ' + MED_SOON_DAYS + ' days shows under Coming up, so you can buy a fresh pack in time and throw the old one away safely.' }),
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
    chip('all', 'All', active.length), chip('soon', 'Coming up', soon.length), chip('past', 'Used up / disposed', closed.length),
  ]));
  const search = el('input', { type: 'search', class: 'med-search', placeholder: 'Search name, purpose or use', value: _medSearch });
  host.appendChild(search);
  const listHost = el('div', {});
  host.appendChild(listHost);

  const matches = (m) => {
    const q = _medSearch.trim().toLowerCase();
    if (!q) return true;
    return [m.name, m.purpose, m.type, m.usage, nameOf(m.personId), normaliseWhen(m.when).map(timeLabel).join(' ')].some((x) => String(x || '').toLowerCase().includes(q));
  };

  const card = (m, opts) => {
    const s = m._status || medStatus(m, today);
    const who = m.personId != null ? nameOf(m.personId) : null;
    const actions = [];
    if (opts && opts.actions) {
      actions.push(el('button', { type: 'button', class: 'med-act is-buy', onclick: (e) => { e.stopPropagation(); openMedicineForm(null, { people, rerender, restockOf: m }); } },
        [el('span', { class: 'med-act-plus', text: '+' }), 'Buy again']));
      if (s.state === 'expired') {
        actions.push(el('button', { type: 'button', class: 'med-act is-dispose', onclick: async (e) => { e.stopPropagation(); if (await disposeMedicine(m)) rerender(); } }, ['🗑️ Dispose']));
      }
    }
    return el('div', { class: 'med-card is-' + s.state, role: 'button', tabindex: '0', onclick: () => openMedicineForm(m, { people, rerender }) }, [
      el('div', { class: 'med-row' }, [
        typeIcon(m.type, 'med-ico'),
        el('div', { class: 'med-main' }, [
          el('div', { class: 'med-name', text: m.name || 'Medicine' }),
          el('div', { class: 'med-tags' }, [
            m.type ? el('span', { class: 'med-tag', text: m.type }) : null,
            m.purpose ? el('span', { class: 'med-tag is-purpose', text: m.purpose }) : null,
            el('span', { class: 'med-tag is-who', text: who || 'Household' }),
          ].filter(Boolean)),
        ]),
        el('div', { class: 'med-exp' }, [
          el('span', { class: 'med-exp-date', text: isClosed(m) ? (m.closedOn ? 'on ' + m.closedOn.split('-').reverse().join('/') : '') : 'Exp ' + expiryLabel(m.expiry) }),
          el('span', { class: 'med-status is-' + s.state, text: statusText(s) }),
        ]),
      ]),
      normaliseWhen(m.when).length ? el('div', { class: 'med-when' }, whenChips(m.when)) : null,
      m.usage ? el('div', { class: 'med-usage' }, [el('b', { text: 'How to use: ' }), document.createTextNode(m.usage)]) : null,
      actions.length ? el('div', { class: 'med-acts' }, actions) : null,
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
        el('div', { class: 'med-sec-head' }, [el('span', { text: '⏰ Coming up' }), el('span', { class: 'med-sec-hint', text: 'buy again before it runs out of date' })]),
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
const PURPOSE_ICON = { Fever: '🌡️', Pain: '🤕', 'Cold / cough': '🤧', Stomach: '🤢', Allergy: '🌾', Eye: '👁️', Nose: '👃', Mouth: '👄', Wound: '🩹', 'First aid': '🧰', Skin: '🖐️', 'BP / sugar': '🩸', Vitamins: '🍊', Other: '➕' };
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
function pickGroup(options, value, cls, allowNone) {
  let cur = value || '';
  const wrap = el('div', { class: 'medf-pick ' + (cls || ''), role: 'radiogroup' });
  const btns = options.map((op) => {
    const b = el('button', { type: 'button', class: 'medf-opt', role: 'radio', onclick: () => { cur = allowNone && cur === op.value ? '' : op.value; sync(); } },
      [op.iconEl ? op.iconEl() : op.icon ? el('span', { class: 'medf-opt-ico', text: op.icon }) : null, el('span', { class: 'medf-opt-txt', text: op.label })].filter(Boolean));
    b._v = op.value;
    wrap.appendChild(b);
    return b;
  });
  const sync = () => btns.forEach((b) => { const on = b._v === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  sync();
  return { node: wrap, get value() { return cur; }, set(v) { cur = v || ''; sync(); } };
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
  const type = pickGroup(withExtra(MED_TYPES, base.type).map((t) => ({ value: t, label: TYPE_SHORT[t] || t, iconEl: () => typeIcon(t, 'medf-opt-ico') })), base.type, 'is-tiles', true);
  const purpose = pickGroup(withExtra(MED_PURPOSES, base.purpose).map((p) => ({ value: p, label: p, icon: PURPOSE_ICON[p] || '•' })), base.purpose, 'is-chips', true);

  // ---- How to use ----
  const usage = el('textarea', { rows: '3', class: 'medf-usage', placeholder: 'Dose and how to take it - e.g. 1 tablet after food, or 10 ml with water' });
  usage.value = base.usage || '';
  // When to use: Morning / Afternoon / Night, any of them; what is picked shows on the medicine's card.
  const whenSel = new Set(normaliseWhen(base.when));
  const whenBtns = MED_TIMES.map(([id, label]) => {
    const b = el('button', { type: 'button', class: 'medf-time is-' + id, 'aria-pressed': 'false', onclick: () => { if (whenSel.has(id)) whenSel.delete(id); else whenSel.add(id); syncWhen(); } }, [
      el('span', { class: 'medf-time-ico', text: TIME_ICON[id] }), el('span', { class: 'medf-time-txt', text: label }), el('span', { class: 'medf-time-tick', text: '✓' }),
    ]);
    b._id = id;
    return b;
  });
  const syncWhen = () => whenBtns.forEach((b) => { const on = whenSel.has(b._id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  syncWhen();
  const whenRow = el('div', { class: 'medf-when' }, [el('div', { class: 'medf-when-label', text: 'When to use' }), el('div', { class: 'medf-times' }, whenBtns)]);

  // ---- For whom ----
  const whoStart = base.personId != null && people.some((p) => p.id === base.personId) ? String(base.personId) : '';
  const who = pickGroup([{ value: '', label: 'Household', icon: '🏠' }].concat(people.map((p) => ({ value: String(p.id), label: p.name, icon: '👤' }))), whoStart, 'is-chips', false);

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
      : s.state === 'soon' ? '⚠ Expires ' + (s.days === 0 ? 'today' : 'in ' + s.days + (s.days === 1 ? ' day' : ' days')) + ' (' + end + ') - it will show under Coming up.'
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
    const n = name.value.trim();
    if (!n) { toast('Add the medicine name'); name.focus(); return; }
    const expiry = expiryValue();
    if (!expiry) { toast('Pick the expiry month and year from the pack'); (mon.value ? year : mon).focus(); return; }
    const now = new Date().toISOString();
    const rec = Object.assign({}, existing || {}, {
      name: n.slice(0, 80), type: type.value, purpose: purpose.value, usage: usage.value.trim().slice(0, 500), when: normaliseWhen([...whenSel]),
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
    : opts.restockOf ? 'Same medicine, new pack - just set its expiry.' : 'Note it once; Coming up reminds you before it expires.';
  const more = [];
  if (isEdit && !isClosed(existing)) {
    more.push(el('button', { class: 'btn ghost', type: 'button', text: '✓ Used up', onclick: () => close('used') }));
    more.push(el('button', { class: 'btn ghost medf-dispose', type: 'button', text: '🗑️ Dispose', onclick: () => close('disposed') }));
  }
  if (isEdit && isClosed(existing)) more.push(el('button', { class: 'btn ghost', type: 'button', text: '↩ Back in cabinet', onclick: () => close('active') }));
  if (isEdit) more.push(el('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: del }));

  openModal(el('div', { class: 'sheet has-fixed-footer medf' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'medf-head' }, [
        typeIcon(base.type, 'medf-head-ico'),
        el('div', { class: 'medf-head-text' }, [el('h2', { text: title }), el('p', { class: 'medf-head-sub', text: sub })]),
      ]),
      restockNote,
      el('div', { class: 'form-sec' }, [
        field('Name', el('div', {}, [name, datalist, nameHint])),
        field('Type', type.node),
        field('What is it for?', purpose.node),
      ]),
      formSection('🕒', 'How to use', [usage, whenRow]),
      formSection('👪', 'For whom', [who.node]),
      formSection('📅', 'Pack', [
        field('Expiry (EXP on the pack)', el('div', { class: 'medf-exp-row' }, [mon, year])),
        quickExp,
        expStatus,
        field('Bought on', bought),
        disposeOld ? el('label', { class: 'medf-toggle' }, [disposeOld, el('span', { class: 'medf-toggle-text' }, [
          el('b', { text: 'Dispose of the old pack' }),
          el('small', { text: 'Marks it disposed today, so it leaves Coming up.' }),
        ])]) : null,
      ].filter(Boolean)),
    ].filter(Boolean)),
    el('div', { class: 'sheet-footer' }, [
      el('div', { class: 'btn-row medf-actions' }, [
        el('button', { class: 'btn primary medf-save', type: 'button', text: isEdit ? 'Save changes' : opts.restockOf ? 'Add new pack' : 'Save medicine', onclick: save }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: closeModal }),
      ]),
      more.length ? el('div', { class: 'btn-row medf-more' }, more) : null,
    ].filter(Boolean)),
  ]));
  if (!isEdit && !opts.restockOf) setTimeout(() => name.focus(), 60);
}
