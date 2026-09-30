import { $, getOverallView, setOverallView, appConfirm, b, closeModal, el, field, installPortfolioSwipe, isPaidPlan, openModal, render, renderList, renderTrends, segChoice, selectPortfolio, state, toast, updateChromeActive, updateFiltersActive, updateSortButtons } from './app.js';
import { gripHandle, makeDragSortable } from './drag-sort.js';
import { DB } from './db.js';
import { PORTFOLIOS, curOf } from './core.js';

// ---------- chrome (built once, only active state toggles afterward) ----------
// Profiles for other people (Wife already existed as a fixed built-in; these are the general case -
// any name, in either market). Loaded once near plan/init and kept in memory, rebuilt into the tab
// strip whenever it changes (added, edited, deleted, or the plan itself changes). A profile's portfolio
// id is DERIVED from its stockProfiles row id ('cp<id>-in' / 'cp<id>-us'), never stored redundantly, so
// renaming it never touches the stock/snapshot/monthly records already filed under that id.
let _customProfiles = [];
export async function loadCustomProfiles() {
  const rows = await DB.all('stockProfiles').catch(() => []);
  _customProfiles = rows.map((p) => ({
    id: 'cp' + p.id + '-' + (p.market === 'US' ? 'us' : 'in'),
    label: p.name + ' · ' + (p.market === 'US' ? 'US' : 'India'),
    cur: p.market === 'US' ? 'USD' : 'INR',
    name: p.name, market: p.market === 'US' ? 'US' : 'IN', dbId: p.id, createdAt: p.createdAt, custom: true,
    // Whether this profile's figures count toward the "India combined" total on Overview - on by
    // default (absent === true), same as Wife always was before this was ever a choice.
    includeInTotal: p.includeInTotal !== false,
  }));
}
// Wife's own display name, editable from the Profiles sheet - stored as an ordinary settings key
// (not a new store) since it changes nothing about the record shape: 'wife-in' stays 'wife-in' forever,
// only the label shown for it changes. Null/unset means "Wife", the name it always had.
let _wifeName = null;
let _wifeIncludeInTotal = true;
// Wife can be deleted like any other profile, but 'wife-in' is a fixed id old backups depend on, so
// "deleted" is a hidden flag, not a removed record. It un-hides by itself once holdings exist under
// wife-in again (a backup restored here), so imported data never sits under a tab nobody can see.
let _wifeHidden = false;
export async function loadWifeName() {
  const [r, inc, hid] = await Promise.all([
    DB.get('meta', 'wifeName').catch(() => null),
    DB.get('meta', 'wifeIncludeInTotal').catch(() => null),
    DB.get('meta', 'wifeHidden').catch(() => null),
  ]);
  _wifeName = (r && r.value) ? String(r.value) : null;
  _wifeIncludeInTotal = !(inc && inc.value === false);
  _wifeHidden = !!(hid && hid.value === true);
  if (_wifeHidden) {
    const held = await DB.byPortfolio('stocks', 'wife-in').catch(() => []);
    if (held.length) _wifeHidden = false;
  }
}
// Every portfolio this device has ever known about, built-in or custom, regardless of the current
// plan - used to resolve a label/currency for data that may have been created under Pro/Beta and is
// now just being read back (a downgrade must never turn old records into a blank "undefined").
export function allKnownProfiles() {
  return PORTFOLIOS.map((p) => (p.id === 'wife-in' && _wifeName ? { ...p, label: _wifeName + ' · India' } : p))
    .concat(_customProfiles);
}
// Wife (and any custom profile) is a Pro/Beta feature; Free stays on the single "me" portfolios
// (India + US), same as it always has.
// The order the person dragged the profiles into (Pro/Beta), a list of profile ids kept as a settings key -
// no new store, so old backups import unchanged. Anyone not in it (a profile added later) follows in the
// default order; the Free plan always keeps the fixed Me · India, Me · US.
let _profileOrder = [];
export async function loadProfileOrder() {
  const r = await DB.get('meta', 'profileOrder').catch(() => null);
  _profileOrder = Array.isArray(r && r.value) ? r.value : [];
}
export function visiblePortfolios() {
  if (!isPaidPlan()) return PORTFOLIOS.filter((p) => p.id !== 'wife-in');
  const list = allKnownProfiles().filter((p) => !(p.id === 'wife-in' && _wifeHidden));
  const at = (p) => { const i = _profileOrder.indexOf(p.id); return i < 0 ? 1e6 + list.indexOf(p) : i; };
  return list.slice().sort((a, b) => at(a) - at(b));
}
// The tabs as shown right now (names included) - for other screens that list profiles, e.g. the Feed.
export function stockProfilesShown() { return visiblePortfolios(); }
// Your own two always count; everyone else only while their "In total" switch is on.
export const _profileIncluded = (p) => p.id === 'me-in' || p.id === 'me-us'
  || (p.id === 'wife-in' ? _wifeIncludeInTotal : p.includeInTotal !== false);
async function setProfileIncluded(p, on) {
  if (p.id === 'wife-in') { await DB.put('meta', { key: 'wifeIncludeInTotal', value: on }); _wifeIncludeInTotal = on; return; }
  const row = await DB.get('stockProfiles', p.dbId);
  if (!row) return;
  row.includeInTotal = on;
  await DB.put('stockProfiles', row);
  await loadCustomProfiles();
}
// Profiles beyond your own two whose switch is on - Home's Total Invested adds their holdings (a US one
// converted to rupees, same as Me · US). Pro/Beta only, the same gate as their tabs.
export async function includedStockProfiles() {
  if (!isPaidPlan()) return [];
  await Promise.all([loadCustomProfiles().catch(() => {}), loadWifeName().catch(() => {}), loadProfileOrder().catch(() => {})]);
  return visiblePortfolios().filter((p) => p.id !== 'me-in' && p.id !== 'me-us' && _profileIncluded(p));
}
// Deletes a profile and everything filed under it (holdings held and sold, snapshots, month-end records,
// cached news) after one confirmation that says how much goes with it. Returns true when deleted.
async function deleteProfile(p) {
  const isWife = p.id === 'wife-in';
  const name = isWife ? (_wifeName || 'Wife') : p.name;
  const [stocks, snaps, months, feed] = await Promise.all(['stocks', 'snapshots', 'monthly', 'feed']
    .map((st) => DB.byPortfolio(st, p.id).catch(() => [])));
  const held = stocks.filter((x) => x.status !== 'sold').length, sold = stocks.length - held;
  const parts = [];
  if (held) parts.push(held + (held === 1 ? ' holding' : ' holdings'));
  if (sold) parts.push(sold + ' sold');
  if (months.length) parts.push(months.length + ' month-end record' + (months.length === 1 ? '' : 's'));
  const msg = 'Delete ' + name + '’s profile' + (parts.length ? ' and everything in it (' + parts.join(', ') + ')' : '')
    + '? This cannot be undone' + (parts.length ? ' - take a backup first if you might want it back.' : '.');
  if (!(await appConfirm(msg))) return false;
  await Promise.all([
    ...stocks.map((x) => DB.del('stocks', x.id)), ...snaps.map((x) => DB.del('snapshots', x.id)),
    ...months.map((x) => DB.del('monthly', x.key)), ...feed.map((x) => DB.del('feed', x.key)),
  ].map((pr) => pr.catch(() => {})));
  if (isWife) {
    await Promise.all([
      DB.put('meta', { key: 'wifeHidden', value: true }),
      DB.put('meta', { key: 'wifeName', value: null }),
      DB.put('meta', { key: 'wifeIncludeInTotal', value: true }),
    ]);
    await loadWifeName();
  } else {
    await DB.del('stockProfiles', p.dbId);
    await loadCustomProfiles();
  }
  if (state.portfolio === p.id) await selectPortfolio('me-in');
  buildChrome();
  updateChromeActive();
  toast('Profile deleted');
  return true;
}
export function curOfAny(id) {
  const p = allKnownProfiles().find((x) => x.id === id);
  return p ? p.cur : curOf(id);
}
export function buildChrome() {
  const tabs = $('#portfolioTabs');
  tabs.innerHTML = '';
  visiblePortfolios().forEach((p) => tabs.appendChild(el('button', {
    class: 'ptab', 'data-id': p.id, text: p.label,
    onclick: () => {
      // On Overview, picking a portfolio also means "leave Overall" - including
      // picking the one already underneath it, which selectPortfolio would
      // otherwise treat as a no-op and leave the tap doing nothing visible.
      if (state.view === 'trends' && getOverallView()) {
        setOverallView(false);
        if (state.portfolio === p.id) { updateChromeActive(); renderTrends(); return; }
      }
      selectPortfolio(p.id);
    },
  })));
  // Add another person's profile - Pro/Beta only, same gate as Wife. Sits right after the last
  // portfolio tab, before Overall, so it reads as "one more" rather than a stray control elsewhere.
  if (isPaidPlan()) {
    tabs.appendChild(el('button', {
      class: 'ptab-add', type: 'button', 'aria-label': 'Add a profile', title: 'Add a profile',
      onclick: () => openProfilesSheet(),
    }, [el('span', { 'aria-hidden': 'true', text: '+' })]));
  }
  // Only ever shown on the Overview tab. On Holdings or the Heatmap there is no
  // such thing as "all three portfolios at once" - the list, the prices and the
  // currency all belong to one of them.
  tabs.appendChild(el('button', {
    class: 'ptab is-overall hidden', 'data-id': 'overall', text: 'Overall',
    onclick: () => { if (getOverallView()) return; setOverallView(true); updateChromeActive(); renderTrends(); },
  }));
  installPortfolioSwipe();

  const nav = $('#bottomNav');
  nav.innerHTML = '';
  [['holdings', '📈', 'Holdings'], ['heatmap', '🗺️', 'Heatmap'], ['monthly', '🗓️', 'Trend'], ['trends', '📊', 'Overview'], ['feed', '📰', 'Feed']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (state.view === v) return; state.view = v; render(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });

  const sortBar = $('#sortBar');
  // `onclick =`, not addEventListener: these buttons live in index.html and survive every buildChrome(),
  // which runs more than once a session - stacked listeners made one tap sort and then un-sort.
  sortBar.querySelectorAll('[data-field]').forEach((btn) => {
    btn.onclick = () => {
      const f = btn.getAttribute('data-field');
      // Same as Mutual Funds: the first tap sorts (return/value high-first, name A-Z), tapping the same
      // chip again flips the order - no third "off" step in between any more.
      if (state.sortField === f && state.sortStage > 0) state.sortStage = state.sortStage === 1 ? 2 : 1;
      else { state.sortField = f; state.sortStage = 1; }
      updateSortButtons();
      renderList();
    };
  });
  updateSortButtons();

  const seg = $('#filterSeg');
  seg.innerHTML = '';
  [['holding', 'Holding'], ['sold', 'Sold']].forEach(([v, label]) => {
    seg.appendChild(el('button', {
      'data-filter': v, text: label,
      onclick: () => { if (state.filter === v) return; state.filter = v; updateFiltersActive(); renderList(); },
    }));
  });
}

// ---------- profiles (Pro/Beta: track other people's holdings) ----------
// The list-then-add/edit sheet, opened from the + next to the portfolio tabs.
function openProfilesSheet() {
  // Me · India and Me · US are the only two true built-ins - fixed, always present, never renamed or
  // removed (Free plan is locked to exactly these two). They can be dragged into any place, like the rest.
  const builtRow = (p) => el('div', { class: 'profile-row is-builtin', 'data-key': p.id }, [
    gripHandle('profile-grip'),
    el('span', { class: 'profile-row-name', text: p.label.split(' · ')[0] }),
    el('span', { class: 'profile-row-market', text: p.cur === 'USD' ? 'US' : 'India' }),
    el('span', { class: 'profile-row-tag', text: 'Built-in' }),
  ]);
  // Everyone else - Wife (a fixed id, but renamable and deletable) and custom profiles. Each row: tap the
  // name to edit, a switch for whether it counts in Total Invested, and a delete button.
  const otherRow = (p) => {
    const isWife = p.id === 'wife-in';
    const name = isWife ? p.label.split(' · ')[0] : p.name;
    const chk = el('input', { type: 'checkbox', 'aria-label': 'Include ' + name + ' in Total Invested' });
    chk.checked = _profileIncluded(p);
    chk.addEventListener('change', async () => {
      await setProfileIncluded(p, chk.checked);
      toast(chk.checked ? name + ' now counts in Total Invested' : name + ' left out of Total Invested');
    });
    const sw = el('label', { class: 'switch switch-sm', title: 'Include in Total Invested' },
      [chk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]);
    const edit = el('button', { class: 'profile-row-main', type: 'button', 'aria-label': 'Edit ' + name }, [
      el('span', { class: 'profile-row-name', text: name }),
      el('span', { class: 'profile-row-market', text: p.cur === 'USD' ? 'US' : 'India' }),
    ]);
    edit.addEventListener('click', () => {
      closeModal();
      if (isWife) openWifeNameForm(); else openProfileForm(_customProfiles.find((x) => x.id === p.id) || p);
    });
    const del = el('button', { class: 'profile-row-del', type: 'button', 'aria-label': 'Delete ' + name, title: 'Delete profile', text: '🗑' });
    del.addEventListener('click', async () => { if (await deleteProfile(p)) { closeModal(); openProfilesSheet(); } });
    return el('div', { class: 'profile-row is-other', 'data-key': p.id }, [gripHandle('profile-grip'), edit, sw, del]);
  };
  const list = el('div', { class: 'profile-list' }, visiblePortfolios().map((p) => (p.id === 'me-in' || p.id === 'me-us' ? builtRow(p) : otherRow(p))));
  makeDragSortable(list, {
    itemSel: '.profile-row', handleSel: '.drag-grip',
    onDone: async (keys) => {
      _profileOrder = keys;
      await DB.put('meta', { key: 'profileOrder', value: keys }).catch(() => {});
      buildChrome(); updateChromeActive();
      toast('Order saved');
    },
  });
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Profiles' }),
    el('p', { class: 'hint', text: 'Each profile gets its own tab, its own holdings and its own totals — never mixed with yours. Drag ≡ to set the order of the tabs.' }),
    list,
    el('p', { class: 'hint', text: 'The switch adds a profile’s holdings to Total Invested on Home (US converted to ₹). Your own two always count.' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: '+ Add profile', onclick: () => { closeModal(); openProfileForm(null); } }),
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}
// Wife's name is the only thing that can change about it - the market (India) and the portfolio id
// (wife-in) are fixed for good, so this is a much smaller form than openProfileForm.
function openWifeNameForm() {
  const current = _wifeName || 'Wife';
  const name = el('input', { type: 'text', value: current, placeholder: 'Wife', maxlength: '40' });
  const nameField = field('Name', name);
  const includeChk = el('input', { type: 'checkbox' });
  includeChk.checked = _wifeIncludeInTotal;
  const includeSwitch = el('label', { class: 'switch' }, [includeChk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]);
  const includeField = field('Include in total investment', includeSwitch);
  includeField.appendChild(el('p', { class: 'hint', text: 'Adds this profile’s holdings to Total Invested on Home.' }));
  const save = async () => {
    const n = name.value.trim() || 'Wife';
    const renamed = n !== current;
    if (renamed && !(await appConfirm('Rename ' + current + ' to ' + n + '? This only changes the name shown - holdings and totals are unaffected.'))) return;
    await Promise.all([
      DB.put('meta', { key: 'wifeName', value: n === 'Wife' ? null : n }),
      DB.put('meta', { key: 'wifeIncludeInTotal', value: includeChk.checked }),
    ]);
    await loadWifeName();
    buildChrome();
    updateChromeActive();
    closeModal();
    toast('Profile updated');
    openProfilesSheet();
  };
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Edit profile' }),
    nameField,
    field('Market', el('p', { class: 'hint', style: 'margin:0', text: 'India (₹) — always has been, can’t be changed.' })),
    includeField,
    el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn danger', text: 'Delete', onclick: async () => {
        const w = visiblePortfolios().find((x) => x.id === 'wife-in');
        if (w && await deleteProfile(w)) { closeModal(); openProfilesSheet(); }
      } }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { closeModal(); openProfilesSheet(); } }),
    ]),
  ]));
}
// Add (existing == null) or edit an existing profile. The market is fixed once a profile is created:
// changing it would silently strand any holdings already logged under the old portfolio id, since the
// id is derived from the market ('cp<id>-in' vs 'cp<id>-us'), not stored as its own field.
function openProfileForm(existing) {
  const isEdit = !!(existing && existing.dbId != null);
  const name = el('input', { type: 'text', value: existing ? existing.name : '', placeholder: 'e.g. Mom, Dad, Brother', maxlength: '40' });
  const nameField = field('Name', name);
  // Whether this profile's figures count toward the "India combined" total on Overview - INR only,
  // since that total is INR-only. Someone you're tracking out of curiosity, not managing your own money
  // through, can be switched out of it without deleting or hiding the profile itself.
  const includeChk = el('input', { type: 'checkbox' });
  includeChk.checked = isEdit ? existing.includeInTotal !== false : true;
  const includeSwitch = el('label', { class: 'switch' }, [includeChk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]);
  const includeField = field('Include in total investment', includeSwitch);
  includeField.appendChild(el('p', { class: 'hint', text: 'Adds their holdings to Total Invested on Home (US converted to ₹).' }));
  const market = segChoice([['IN', 'India (₹)'], ['US', 'US ($)']], existing ? existing.market : 'IN', () => {});
  const marketField = field('Market', market.node);
  if (isEdit) {
    market.node.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    marketField.appendChild(el('p', { class: 'hint', text: 'Can’t be changed once a profile has holdings logged under it.' }));
  }
  const save = async () => {
    const n = name.value.trim();
    if (!n) { toast('Enter a name'); name.focus(); return; }
    if (isEdit) {
      const renamed = n !== existing.name;
      if (renamed && !(await appConfirm('Rename ' + existing.name + ' to ' + n + '? This only changes the name shown - holdings and totals are unaffected.'))) return;
      await DB.put('stockProfiles', { id: existing.dbId, name: n, market: existing.market, createdAt: existing.createdAt, includeInTotal: includeChk.checked });
      await loadCustomProfiles();
      buildChrome();
      updateChromeActive();
      closeModal();
      toast('Profile updated');
      openProfilesSheet();
    } else {
      const dbId = await DB.put('stockProfiles', { name: n, market: market.value, createdAt: new Date().toISOString(), includeInTotal: includeChk.checked });
      await loadCustomProfiles();
      buildChrome();
      closeModal();
      toast(n + ' added');
      const created = _customProfiles.find((p) => p.dbId === dbId);
      if (created) selectPortfolio(created.id);
      updateChromeActive();
    }
  };
  const del = async () => { if (await deleteProfile(existing)) { closeModal(); openProfilesSheet(); } };
  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { closeModal(); openProfilesSheet(); } }));
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: isEdit ? 'Edit profile' : 'Add profile' }),
    nameField,
    marketField,
    includeField,
    el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns),
  ]));
}

