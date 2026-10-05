import { ui } from './state.js';
import { DB } from './db.js';
import { el, b, $, toast, closeModal, openModal, expRenderStale } from './app.js';
import { renderHomeExpense, round2, _mountMonthStrip, _attachMonthSwipe } from './expense-ui.js';

// ---------- Allocation tracker (Expense → Yearly plan tab) ----------
export async function renderAllocation(host, token) {
  // This is called again on every year-switch and after every save (not just
  // on first entry to the tab, unlike most other renderX functions which are
  // only ever called once per tab-open from an already-cleared host) — clear
  // it every time or the whole section (header, year buttons, cards, total)
  // piles up underneath its previous copy instead of replacing it.
  host.innerHTML = '';
  // Everything goes in one wrapper so the swipe below is attached to something fresh on every render (this host
  // is re-used, and a listener on it would stack up with each year switch).
  const root = el('div', { class: 'alloc-root' });
  host.appendChild(root);
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
  root.appendChild(header);

  if (allocYears.length === 0) {
    root.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🧭' }),
      el('p', { text: 'No allocations recorded yet.' }),
      el('p', { class: 'hint', text: 'Click "Add Year" to start tracking how your income is allocated — you can enter this year or any past year.' }),
    ]));
    return;
  }

  // Years as a strip of tabs, the same look as the month timeline (newest first); swiping the page left or
  // right steps to the next year.
  const pickYear = (y) => { if (y === selectedYear) return; ui._allocYear = y; ui._allocStripClicked = true; renderHomeExpense(); };
  const appHeader = document.querySelector('.app-header');
  const yearWrap = el('div', { class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline', style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px' });
  yearWrap.appendChild(el('div', { class: 'cc-timeline' }, allocYears.map((y) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip has-data' + (y === selectedYear ? ' active' : '') + (y === curYear ? ' is-current' : ''),
    text: String(y), onclick: () => pickYear(y),
  }))));
  root.appendChild(yearWrap);
  _mountMonthStrip('alloc-years', yearWrap, !!ui._allocStripClicked);
  ui._allocStripClicked = false;
  _attachMonthSwipe(root, allocYears.slice().sort((x, y) => x - y), selectedYear, pickYear);

  const curAlloc = allAllocs.find(a => a.year === selectedYear);
  const prevAlloc = allAllocs.find(a => a.year === selectedYear - 1);
  const v = (a, k) => (a ? Number(a[k]) || 0 : 0);
  const rupees = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  // Year-on-year change for one line: a % when last year had it, "new" when only this year does, nothing
  // when there is no earlier year to compare with at all.
  const yoy = (cur, prev) => {
    if (!prevAlloc) return null;
    if (prev > 0) {
      const p = ((cur - prev) / prev) * 100;
      return { text: (p > 0 ? '▲ ' : p < 0 ? '▼ ' : '') + Math.abs(Math.round(p)) + '%', cls: p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'flat' };
    }
    return cur > 0 ? { text: 'new', cls: 'new' } : null;
  };
  const yoyChip = (y) => (y ? el('span', { class: 'al-yoy al-yoy-' + y.cls, title: 'vs ' + (selectedYear - 1), text: y.text }) : null);

  // Same three groups as the form, each with its own colour, so the page and the form read alike.
  const GROUPS = [
    { label: 'Fixed expenses', icon: '\u{1F3E0}', color: '#f59e0b', keys: ['home', 'houseExp', 'card'] },
    { label: 'Investments', icon: '\u{1F4C8}', color: '#10b981', keys: ['mf', 'fd', 'indStock', 'usStock', 'metal'] },
    { label: 'Contingency', icon: '\u{1F6E1}\u{FE0F}', color: '#8b5cf6', keys: ['emergency', 'savings'] },
  ];
  const catOf = (k) => allocCategories.find((c) => c.key === k);
  const salary = v(curAlloc, 'salary'), prevSalary = v(prevAlloc, 'salary');
  const sumOf = (a, keys) => keys.reduce((s, k) => s + v(a, k), 0);
  const allKeys = GROUPS.flatMap((g) => g.keys);
  const allocated = round2(sumOf(curAlloc, allKeys));
  const prevAllocated = round2(sumOf(prevAlloc, allKeys));
  // Balance is derived, never stored: salary less every other line. Negative means the plan allocates
  // more than it earns, shown in red rather than clamped at zero.
  const bal = round2(salary - allocated);
  const pctOfSalary = (n) => (salary > 0 ? (n / salary) * 100 : 0);

  // ---- Hero: salary, where it goes (one stacked bar), and what is left ----
  const bar = el('div', { class: 'al-bar', role: 'img', 'aria-label': 'How the salary is split' });
  GROUPS.forEach((g) => {
    const amt = sumOf(curAlloc, g.keys);
    if (amt > 0 && salary > 0) {
      bar.appendChild(el('span', { class: 'al-bar-seg', title: g.label + ' ' + Math.round(pctOfSalary(amt)) + '%',
        style: 'width:' + Math.min(100, pctOfSalary(amt)).toFixed(2) + '%;background:' + g.color }));
    }
  });
  const legendItems = GROUPS.map((g) => {
    const amt = sumOf(curAlloc, g.keys);
    return el('span', { class: 'al-legend-i' }, [
      el('i', { style: 'background:' + g.color }),
      document.createTextNode(g.label + ' '),
      el('b', { text: salary > 0 ? Math.round(pctOfSalary(amt)) + '%' : rupees(amt) }),
    ]);
  });
  if (bal > 0 && salary > 0) {
    legendItems.push(el('span', { class: 'al-legend-i' }, [
      el('i', { class: 'al-free' }), document.createTextNode('Unallocated '), el('b', { text: Math.round(pctOfSalary(bal)) + '%' }),
    ]));
  }
  root.appendChild(el('div', { class: 'al-hero' }, [
    el('div', { class: 'al-hero-top' }, [
      el('div', {}, [
        el('div', { class: 'al-k', text: 'Salary · per month' }),
        el('div', { class: 'al-hero-v', text: rupees(salary) }),
      ]),
      yoyChip(yoy(salary, prevSalary)),
    ].filter(Boolean)),
    bar,
    el('div', { class: 'al-legend' }, legendItems),
    el('div', { class: 'al-hero-foot' }, [
      el('div', {}, [
        el('div', { class: 'al-k', text: 'Allocated' }),
        el('div', { class: 'al-foot-row' }, [el('span', { class: 'al-foot-v', text: rupees(allocated) }), yoyChip(yoy(allocated, prevAllocated))].filter(Boolean)),
      ]),
      el('div', { class: 'al-balance' + (bal < 0 ? ' is-neg' : '') }, [
        el('div', { class: 'al-k', text: bal < 0 ? 'Over by' : 'Balance' }),
        el('div', { class: 'al-foot-v', text: rupees(Math.abs(bal)) }),
      ]),
    ]),
  ]));

  // ---- One card per group: each line with its share of the salary and its change vs last year ----
  GROUPS.forEach((g) => {
    const lines = g.keys.map((k) => {
      const cat = catOf(k);
      const shared = k === 'houseExp' && curAlloc && curAlloc.sharedOn ? Number(curAlloc.sharedAmount) || 0 : 0;
      return { cat, val: v(curAlloc, k), prev: v(prevAlloc, k), shared };
    }).filter((x) => x.val > 0 || x.prev > 0 || x.shared > 0);
    if (!lines.length) return;
    const total = lines.reduce((s, x) => s + x.val, 0);
    root.appendChild(el('div', { class: 'al-group', style: '--g:' + g.color }, [
      el('div', { class: 'al-group-head' }, [
        el('span', { class: 'al-group-t', text: g.label }),
        el('span', { class: 'al-group-v', text: rupees(total) }),
        salary > 0 ? el('span', { class: 'al-group-pct', text: Math.round(pctOfSalary(total)) + '%' }) : null,
      ].filter(Boolean)),
    ].concat(lines.map((x) => el('div', { class: 'al-line' }, [
      el('div', { class: 'al-line-top' }, [
        el('span', { class: 'al-line-ico', text: x.cat.icon }),
        el('span', { class: 'al-line-l', text: x.cat.label }),
        yoyChip(yoy(x.val, x.prev)),
        el('span', { class: 'al-line-v', text: rupees(x.val) }),
      ].filter(Boolean)),
      el('div', { class: 'al-line-bar' }, [el('span', { style: 'width:' + Math.min(100, pctOfSalary(x.val)).toFixed(2) + '%' })]),
      // Others' contribution to the house: counted in the household budget only, not in the allocations.
      x.shared > 0 ? el('div', { class: 'al-line-sub', title: 'Counted in the household budget only, not added to your allocations' },
        [document.createTextNode('\u{1F91D} Shared by others '), el('b', { text: '+ ' + rupees(x.shared) })]) : null,
    ].filter(Boolean))))));
  });

  root.appendChild(el('p', { class: 'hint alloc-balance-note', text: bal < 0
    ? 'Balance is salary less every other line - negative here, so the plan allocates more than it earns.'
    : 'Balance is salary less every other line: what is left unallocated.' + (prevAlloc ? ' Arrows compare with ' + (selectedYear - 1) + '.' : '') }));

  root.appendChild(el('button', {
    class: 'btn secondary al-edit',
    text: '✎ Edit ' + selectedYear + ' allocations',
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
