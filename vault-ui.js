import { DB } from './db.js';
import { todayISO } from './core.js';
import { state, toast, b, $, el, explainRow, _copyIcon, closeModal, _historyIcon, _editIcon, openModal, appConfirm, menuItem, appAlert, field } from './app.js';

// ---------- My Passwords ----------
//
// A local vault. Rows in the `vault` store hold nothing but an AES-GCM
// envelope; the key is derived from the master password on unlock, lives in
// this one variable, and is gone the moment the section is left or the page
// reloads. See vault.js for what that does and does not protect against - the
// unlock screen says the same thing in one line, because a lock that is
// trusted for more than it does is worse than no lock.
//
// There is no recovery. Nothing on the device can turn a forgotten master
// password back into the vault, which is the direct consequence of not storing
// it - said at setup, where it can still change what the user chooses, rather
// than at the moment it stops mattering.
export let _vaultKey = null;          // CryptoKey while open, null while locked
let _vaultRows = [];           // decrypted, in memory only
let _vaultQuery = '';
let _vaultReveal = null;       // id of the row showing its password
// Same guard the other async renderers carry. This one clears the host and
// then awaits - an import, a store read, a decrypt per row - so two calls
// landing together each cleared and each appended, and the list came out
// twice. Ask for a token, and drop everything if a newer render has started.
let _vaultRenderToken = 0;
const vaultRenderStale = (t) => t !== _vaultRenderToken || state.appMode !== 'vault';
// Flat A-Z, or broken up by category. Remembered, because it is a way of
// reading the list rather than a one-off action, and having to set it again
// on every reload is how a preference becomes an annoyance.
let _vaultGroup = false;
const VAULT_GROUP_KEY = 'vaultGroup';
// Who each entry belongs to. A household vault holds more than one person's
// logins, and "whose is this" is a different question from "what kind of thing
// is this" - so it is its own field and its own filter rather than more
// categories. Names are kept ENCRYPTED, like everything else here: they are
// not secrets on the level of a password, but a store that gives up a family's
// names to anyone reading the database is not a store that leaks nothing.
let _vaultPeople = [];
let _vaultPerson = '';        // '' means everyone; not remembered, it is a look
// The third state the filter can be in, alongside "everyone" and one name.
// A NUL is used rather than a word because a person could perfectly well be
// called Unassigned, and a filter that collides with a real name would quietly
// show the wrong entries - names are trimmed non-empty text, so this can never
// be one of them.
const VAULT_NO_PERSON = '\u0000none';
const VAULT_PEOPLE_KEY = 'vaultPeople';
const VAULT_SALT_KEY = 'vaultSalt';
const VAULT_VERIFY_KEY = 'vaultVerify';
const VAULT_MASTER_TITLE = 'MasterPassword';

export function lockVault(quiet) {
  _vaultKey = null;
  _vaultRows = [];
  _vaultQuery = '';
  _vaultReveal = null;
  if (!quiet) { renderVault(); toast('Vault locked'); }
}

// ---------- Locking itself when you walk away ----------
//
// The key lives in a variable, so it survives the app being backgrounded -
// and that is the case worth closing. A phone put down with the vault open,
// screen off, picked up an hour later by somebody else, is one tap from every
// password in it. Going away relocks it, and coming back asks again.
//
// But NOT instantly. Copying a password is a two-app job: copy here, switch
// there, paste. Locking the moment the page hides would make this app's own
// copy button demand the master password every single time, and a lock that
// punishes normal use is a lock that gets turned off. Half a minute covers
// that round trip and is nothing next to how long a phone sits in a pocket.
//
// Two triggers, because on a phone neither is reliable alone: a timer set when
// the page hides, which a frozen tab may never get to run, and an elapsed
// check when it comes back, which catches whatever the timer missed.
const VAULT_AWAY_MS = 30000;
let _vaultAwayAt = 0;
let _vaultAwayTimer = null;

function _vaultAwayClear() {
  if (_vaultAwayTimer) { clearTimeout(_vaultAwayTimer); _vaultAwayTimer = null; }
  _vaultAwayAt = 0;
}

function _vaultAutoLock() {
  _vaultAwayClear();
  if (!_vaultKey) return;
  lockVault(true);
  // Only worth saying if the screen it happened on is the one being looked at.
  if (state.appMode === 'vault') { renderVault(); toast('Locked while you were away'); }
}

export function watchVaultSession() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!_vaultKey) return;
      _vaultAwayAt = Date.now();
      _vaultAwayTimer = setTimeout(_vaultAutoLock, VAULT_AWAY_MS);
      return;
    }
    if (_vaultKey && _vaultAwayAt && Date.now() - _vaultAwayAt >= VAULT_AWAY_MS) _vaultAutoLock();
    else _vaultAwayClear();
  });
  // The page is being put away for good, or frozen hard enough that nothing of
  // ours will run again until it is restored. Drop the key quietly - there is
  // no screen left to re-render, and if the page does come back it comes back
  // locked, which is the right answer either way.
  window.addEventListener('pagehide', () => { _vaultAwayClear(); if (_vaultKey) lockVault(true); });
}

async function _vaultMeta() {
  const [salt, verify, group] = await Promise.all([
    DB.get('meta', VAULT_SALT_KEY).catch(() => null),
    DB.get('meta', VAULT_VERIFY_KEY).catch(() => null),
    DB.get('meta', VAULT_GROUP_KEY).catch(() => null),
  ]);
  return { salt: salt && salt.value, verify: verify && verify.value, group: !!(group && group.value) };
}

async function _vaultLoadPeople(mod) {
  if (!_vaultKey) return [];
  const row = await DB.get('meta', VAULT_PEOPLE_KEY).catch(() => null);
  if (!row || !row.value) return [];
  const list = await mod.decryptJson(_vaultKey, row.value);
  return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && n.trim()) : [];
}

async function _vaultSavePeople(mod, list) {
  const clean = list.map((n) => String(n).trim()).filter(Boolean);
  const env = await mod.encryptJson(_vaultKey, clean);
  await DB.put('meta', { key: VAULT_PEOPLE_KEY, value: env, updatedAt: new Date().toISOString() });
  _vaultPeople = clean;
}

// Short on purpose - it sits in a corner of a card, not in a report. Today
// gives the time, this year drops the year, anything older keeps it. The full
// stamp is on the tooltip for whoever actually wants it.
function _fmtVaultTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: '2-digit' });
}

// Every row, decrypted. A row that will not open is reported rather than
// dropped: silently showing 9 of 10 passwords is how someone concludes an
// entry was never saved.
async function _vaultLoad(mod) {
  const raw = (await DB.all('vault').catch(() => [])) || [];
  const out = [];
  let failed = 0;
  for (const r of raw) {
    const v = await mod.decryptJson(_vaultKey, r);
    if (!v) { failed++; continue; }
    out.push(Object.assign({ id: r.id, updatedAt: r.updatedAt }, v));
  }
  out.sort((a, b) => String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase()));
  return { rows: out, failed };
}

async function _vaultPut(mod, rec) {
  const body = {};
  mod.VAULT_FIELDS.forEach((f) => { body[f] = rec[f] == null ? '' : String(rec[f]); });
  // Deliberately NOT in VAULT_FIELDS - that list also drives CSV export/
  // import (vault.js's parseCsv), and a JSON blob of old passwords has no
  // business becoming a spreadsheet column. Carried through here instead;
  // decryptJson returns the whole stored object rather than one filtered to
  // VAULT_FIELDS, so this still survives the round trip untouched.
  body.passwordHistory = Array.isArray(rec.passwordHistory) ? rec.passwordHistory : [];
  const env = await mod.encryptJson(_vaultKey, body);
  const row = Object.assign({ updatedAt: new Date().toISOString() }, env);
  if (rec.id != null) row.id = rec.id;
  return DB.put('vault', row);
}

export async function renderVault() {
  if (state.appMode !== 'vault') return;
  const token = ++_vaultRenderToken;
  const host = $('#vaultView');
  host.innerHTML = '';
  const mod = await import('./vault.js');
  const meta = await _vaultMeta();
  if (vaultRenderStale(token)) return;

  // The + only means something once the list behind it is open.
  $('#vaultAddBtn').classList.toggle('hidden', !_vaultKey);

  if (!_vaultKey) { _vaultLockScreen(host, mod, meta); return; }

  const { rows, failed } = await _vaultLoad(mod);
  if (vaultRenderStale(token)) return;
  // The master password is kept, but not as a card. It is not an account you
  // log into anywhere - it is this app's own key, it can never be edited into
  // something meaningful, and sitting in the list it was one more row to
  // scroll past every time. It lives on invisibly, and surfaces in the one
  // place it is any use: already filled in when you go to change it.
  _vaultRows = rows.filter((r) => r.title !== VAULT_MASTER_TITLE);
  _vaultPeople = await _vaultLoadPeople(mod).catch(() => []);
  if (vaultRenderStale(token)) return;
  // A filter pointing at somebody who has since been removed would hide
  // everything and look like an empty vault.
  if (_vaultPerson && _vaultPerson !== VAULT_NO_PERSON
    && _vaultPeople.indexOf(_vaultPerson) < 0) _vaultPerson = '';

  // ---- Toolbar: search, and the two things you do to the vault itself ----
  const search = el('input', {
    type: 'search', class: 'vault-search', placeholder: 'Search titles, accounts, categories',
    value: _vaultQuery, autocomplete: 'off',
  });
  search.addEventListener('input', () => { _vaultQuery = search.value; drawList(); });
  host.appendChild(el('div', { class: 'vault-bar' }, [
    search,
    el('button', { class: 'icon-btn vault-lock', type: 'button', title: 'Lock the vault',
      'aria-label': 'Lock the vault', text: '\ud83d\udd12', onclick: () => lockVault(false) }),
    el('button', { class: 'icon-btn gear-btn', type: 'button', title: 'Vault options',
      'aria-label': 'Vault options', text: '\u2699\ufe0f', onclick: () => openVaultOptions(mod, meta) }),
  ]));

  if (failed) {
    host.appendChild(el('p', { class: 'hint warn', text: failed + (failed === 1 ? ' entry' : ' entries')
      + ' could not be opened with this password. That happens when a backup was restored from a vault '
      + 'with a different master password — those rows cannot be recovered without it.' }));
  }

  _vaultGroup = meta.group;
  const list = el('div', { class: 'vault-list' });
  const modeBtn = (label, on, fn) => el('button', {
    class: 'vault-mode-btn' + (on ? ' active' : ''), type: 'button', text: label, onclick: fn });
  const modes = el('div', { class: 'vault-modes' }, [
    modeBtn('A–Z', !_vaultGroup, () => setGroup(false)),
    modeBtn('By category', _vaultGroup, () => setGroup(true)),
  ]);
  const setGroup = (on) => {
    if (_vaultGroup === on) return;
    _vaultGroup = on;
    DB.put('meta', { key: VAULT_GROUP_KEY, value: on }).catch(() => {});
    [...modes.children].forEach((b, i) => b.classList.toggle('active', (i === 1) === on));
    drawList();
  };
  // Whose, on the same line as how. All first, then everyone in the order they
  // were added - the strip scrolls sideways rather than wrapping, so the two
  // controls stay on one line however many people there are.
  const peopleStrip = el('div', { class: 'vault-people' });
  const drawPeople = () => {
    peopleStrip.innerHTML = '';
    if (!_vaultPeople.length) return;
    const chip = (label, value) => {
      const b = el('button', {
        class: 'vault-who' + (value === _vaultPerson ? ' active' : ''), type: 'button', text: label,
      });
      b.addEventListener('click', () => {
        _vaultPerson = _vaultPerson === value ? '' : value;
        drawPeople();
        drawList();
      });
      return b;
    };
    // Sits next to All rather than after the names: both are states of the
    // list rather than people, they belong together, and on a narrow phone the
    // strip scrolls - putting it last would hide the one chip whose whole job
    // is to be noticed and emptied.
    const loose = _vaultRows.filter((r) => !r.person).length;
    if (!loose && _vaultPerson === VAULT_NO_PERSON) _vaultPerson = '';
    peopleStrip.appendChild(chip('All', ''));
    if (loose) peopleStrip.appendChild(chip('Unassigned', VAULT_NO_PERSON));
    _vaultPeople.forEach((n) => peopleStrip.appendChild(chip(n, n)));
  };
  drawPeople();

  // Only worth offering once there is enough to sort. One entry looks the same
  // either way, and a control that changes nothing invites a tap that does
  // nothing.
  const showModes = _vaultRows.length > 1;
  if (showModes || _vaultPeople.length) {
    host.appendChild(el('div', { class: 'vault-filters' }, [
      showModes ? modes : document.createTextNode(''),
      peopleStrip,
    ]));
  }
  host.appendChild(list);

  function drawList() {
    const q = _vaultQuery.trim().toLowerCase();
    const mine = !_vaultPerson ? _vaultRows
      : _vaultPerson === VAULT_NO_PERSON ? _vaultRows.filter((r) => !r.person)
        : _vaultRows.filter((r) => r.person === _vaultPerson);
    const shown = !q ? mine : mine.filter((r) =>
      [r.title, r.account, r.username, r.url, r.category, r.person]
        .some((f) => String(f || '').toLowerCase().indexOf(q) >= 0));
    list.innerHTML = '';
    if (!_vaultRows.length) {
      list.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'e-icon', text: '\ud83d\udd11' }),
        el('p', { text: 'Nothing saved yet.' }),
        el('p', { class: 'hint', text: 'Tap + to add one. The form will suggest a strong password if you want it to.' }),
      ]));
      return;
    }
    if (!shown.length) {
      const none = _vaultPerson === VAULT_NO_PERSON;
      const why = q && _vaultPerson
        ? (none ? 'Nothing unassigned' : 'Nothing of ' + _vaultPerson + '’s')
          + ' matches ’' + _vaultQuery + '’.'
        : q ? 'Nothing matches ’' + _vaultQuery + '’.'
          : none ? 'Everything here belongs to somebody.'
            : 'Nothing saved under ' + _vaultPerson + ' yet.';
      list.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:16px 0', text: why }));
      return;
    }
    if (!_vaultGroup) { shown.forEach((r) => list.appendChild(_vaultCard(r, mod))); return; }

    const buckets = new Map();
    shown.forEach((r) => {
      const k = r.category || '';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    });
    // In the order the categories are defined, not alphabetically: the list
    // reads Logins, App, Email, Banks the same way every time, which is what
    // makes a grouped list faster to scan than a flat one.
    const order = mod.VAULT_CATEGORIES.map((c) => c.name).filter((n) => buckets.has(n));
    // A category this build does not know - a folder name off an import, say -
    // keeps its own heading instead of being swept into Uncategorised, which
    // would throw away the only label it had.
    [...buckets.keys()].forEach((k) => { if (k && order.indexOf(k) < 0) order.push(k); });
    if (buckets.has('')) order.push('');
    order.forEach((name) => {
      const rows = buckets.get(name);
      const cat = mod.VAULT_CATEGORIES.find((c) => c.name === name);
      list.appendChild(el('div', { class: 'vault-group' }, [
        el('span', { text: (cat ? cat.icon + ' ' : '') + (name || 'Uncategorised') }),
        el('span', { class: 'vault-group-n', text: String(rows.length) }),
      ]));
      rows.forEach((r) => list.appendChild(_vaultCard(r, mod)));
    });
  }
  drawList();

  host.appendChild(explainRow('About My Passwords', [
    'Everything here is encrypted on this device with a key worked out from your master password. '
      + 'The master password itself is never saved, so there is nothing stored that could give it away '
      + '— and nothing that can recover it if you forget it.',
    'The vault locks itself when you leave this screen, when the app reloads, and half a minute '
      + 'after the app goes into the background — so a phone put down with this page open, or gone '
      + 'to sleep in a pocket, asks for the master password again on the way back in.',
    'A backup from the menu carries this vault along with everything else. The entries travel '
      + 'encrypted, exactly as they are stored, and open on the other side with whichever master '
      + 'password was set when that backup was taken.',
    'What this protects: someone picking up the phone, and anyone who gets hold of a backup file, '
      + 'since the backup carries the encrypted rows and not the passwords. What it does not protect '
      + 'against: anyone who knows the master password, or software already running on the phone. '
      + 'Treat it as a locked drawer rather than a safe.',
  ], 'How this is kept'));
}

// ---------- One entry ----------
//
// Two lines and nothing else. The title, and under it whichever of account and
// username exist - which is what tells two logins to the same site apart, and
// is the only thing a list needs to be scanned by. The web address moved into
// the form: it is long, it wraps, it pushed every card to three lines, and it
// is never the thing being looked for.
//
// The eye swaps the second line for the password rather than adding a third,
// so revealing one costs no height at any ordinary length - only a password
// long enough to wrap makes the card grow, and being able to read all of it
// matters more than the line staying put. Only one is open at a time: a
// screen of cards all showing their passwords is what hiding them is for.
function _vaultIcon(r, mod, cls) {
  const ic = mod.iconFor(r);
  if (ic.emoji) return el('div', { class: 'vault-ico' + (cls || ''), text: ic.emoji });
  return el('div', { class: 'vault-ico is-letter' + (cls || ''), text: ic.letter,
    style: '--ico-h:' + mod.iconHue(r.title || '') });
}

// Copying, wherever it happens. Same wording, same failure, one place.
async function _vaultCopy(label, value) {
  if (!value) { toast('Nothing to copy'); return; }
  try { await navigator.clipboard.writeText(value); toast(label + ' copied'); }
  catch (_) { toast('Could not reach the clipboard'); }
}

export function _vaultCopyBtn(label, getValue) {
  const b = el('button', {
    class: 'icon-btn vault-copy', type: 'button',
    title: 'Copy ' + label.toLowerCase(), 'aria-label': 'Copy ' + label.toLowerCase(),
  }, [_copyIcon()]);
  b.addEventListener('click', (e) => { e.stopPropagation(); _vaultCopy(label, getValue()); });
  return b;
}

function _vaultCard(r, mod) {
  const subText = [r.account, r.username].filter(Boolean).join(' · ')
    || r.url || r.category || 'No account or username';
  const sub = el('div', { class: 'vault-sub', text: subText });
  const when = el('div', {
    class: 'vault-when', text: _fmtVaultTime(r.updatedAt),
    title: r.updatedAt ? 'Last updated ' + new Date(r.updatedAt).toLocaleString() : '',
  });
  const acts = el('div', { class: 'vault-act-row' });
  const card = el('div', { class: 'vault-card' }, [
    _vaultIcon(r, mod),
    el('div', { class: 'vault-card-main is-tappable', onclick: () => openVaultDetail(mod, r) }, [
      el('div', { class: 'vault-title', text: r.title || 'Untitled' }),
      sub,
    ]),
    el('div', { class: 'vault-acts' }, [acts, when]),
  ]);

  // No password on this entry - a Wi-Fi note, a customer ID, a document
  // reference - so no eye and no copy. Both buttons would only ever have
  // reported that there was nothing to show and nothing to copy, which is a
  // worse answer than not offering them.
  if (String(r.password || '')) {
    const eye = el('button', { class: 'icon-btn vault-eye', type: 'button' });
    acts.appendChild(eye);
    acts.appendChild(_vaultCopyBtn('Password', () => r.password));
    // Drawn rather than rebuilt. Re-rendering the whole list to show one
    // password threw the scroll position away every time.
    const draw = (on) => {
      card.classList.toggle('is-open', on);
      sub.classList.toggle('is-pw', on);
      sub.textContent = on ? r.password : subText;
      eye.textContent = on ? '\ud83d\ude48' : '\ud83d\udc41';
      eye.title = on ? 'Hide the password' : 'Show the password';
      eye.setAttribute('aria-label', eye.title);
    };
    card._vaultDraw = draw;
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = _vaultReveal !== r.id;
      document.querySelectorAll('#vaultView .vault-card.is-open').forEach((c) => {
        if (c !== card && c._vaultDraw) c._vaultDraw(false);
      });
      _vaultReveal = on ? r.id : null;
      draw(on);
    });
    draw(_vaultReveal === r.id);
  }
  return card;
}

// ---------- Looking at one, before changing it ----------
//
// Tapping a card used to drop straight into the edit form, which is the wrong
// default: reading an entry is the common act and editing one is the rare
// one, and a screen full of live inputs invites a stray keystroke into a
// password you only came to read. This shows what is there, and nothing that
// is not - an entry with no username has no Username line rather than an
// empty box - with one pencil to get to the form when that is what you meant.
function openVaultDetail(mod, r) {
  if (!_vaultKey) return;
  const rows = [];
  const line = (label, value, extras) => {
    rows.push(el('div', { class: 'vd-row' }, [
      el('div', { class: 'vd-label', text: label }),
      typeof value === 'string' ? el('div', { class: 'vd-value', text: value }) : value,
      el('div', { class: 'vd-acts' }, extras || []),
    ]));
  };

  if (r.person) line('Whose', r.person);
  if (r.account) line('Account', r.account, [_vaultCopyBtn('Account', () => r.account)]);
  if (r.username) line('Username', r.username, [_vaultCopyBtn('Username', () => r.username)]);

  if (String(r.password || '')) {
    const dots = '\u2022'.repeat(Math.min(14, Math.max(6, r.password.length)));
    const pwVal = el('div', { class: 'vd-value vd-pw', text: dots });
    const eye = el('button', { class: 'icon-btn vault-eye', type: 'button',
      text: '\ud83d\udc41', title: 'Show the password', 'aria-label': 'Show the password' });
    let shown = false;
    eye.addEventListener('click', () => {
      shown = !shown;
      pwVal.textContent = shown ? r.password : dots;
      pwVal.classList.toggle('is-open', shown);
      eye.textContent = shown ? '\ud83d\ude48' : '\ud83d\udc41';
      eye.title = shown ? 'Hide the password' : 'Show the password';
      eye.setAttribute('aria-label', eye.title);
    });
    // History icon only appears once there IS one - a button that opens
    // nothing is worse than no button at all.
    const hasHistory = Array.isArray(r.passwordHistory) && r.passwordHistory.length > 0;
    const historyBtn = hasHistory ? el('button', {
      class: 'icon-btn vault-history', type: 'button',
      title: 'Password history', 'aria-label': 'Password history',
      onclick: () => { closeModal(); openVaultPasswordHistory(mod, r); },
    }, [_historyIcon()]) : null;
    line('Password', pwVal, [historyBtn, eye, _vaultCopyBtn('Password', () => r.password)].filter(Boolean));
  }

  if (r.url) {
    // Typed without a scheme more often than not, and a bare "netflix.com"
    // in an href resolves against this app rather than the internet.
    const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(r.url) ? r.url : 'https://' + r.url;
    line('Website', el('a', {
      class: 'vd-value vd-link', href, target: '_blank', rel: 'noopener noreferrer', text: r.url,
    }), [_vaultCopyBtn('Address', () => r.url)]);
  }

  // Notes gets one too. It is where recovery codes and security answers end
  // up, which are exactly the things nobody should be retyping by eye.
  if (r.notes) {
    rows.push(el('div', { class: 'vd-row vd-notes-row' }, [
      el('div', { class: 'vd-notes-head' }, [
        el('div', { class: 'vd-label', text: 'Notes' }),
        el('div', { class: 'vd-acts' }, [_vaultCopyBtn('Notes', () => r.notes)]),
      ]),
      el('div', { class: 'vd-value vd-notes', text: r.notes }),
    ]));
  }

  const edit = el('button', {
    class: 'icon-btn vd-edit', type: 'button', title: 'Edit this entry', 'aria-label': 'Edit this entry',
    onclick: () => { closeModal(); openVaultForm(mod, r); },
  }, [_editIcon()]);

  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'vd-head' }, [
        _vaultIcon(r, mod, ' vd-ico'),
        el('div', { class: 'vd-head-text' }, [
          el('h2', { class: 'vd-title', text: r.title || 'Untitled' }),
          r.category ? el('div', { class: 'vd-cat', text: r.category }) : document.createTextNode(''),
        ]),
        edit,
      ]),
      rows.length ? el('div', { class: 'vd-rows' }, rows)
        : el('p', { class: 'hint', text: 'Nothing saved on this one yet but the title. Tap the pencil to fill it in.' }),
      el('p', { class: 'hint vd-when', text: r.updatedAt
        ? 'Last updated ' + new Date(r.updatedAt).toLocaleString() : '' }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn primary', text: 'Edit', onclick: () => { closeModal(); openVaultForm(mod, r); } }),
        el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
      ]),
    ]),
  ]));
}

// A masked value with its own reveal/copy - shared by the current-password
// row and every history row below it, so "show" never means "show every
// password on the timeline at once".
function _vaultMaskedRow(pass, label) {
  const p = String(pass || '');
  const dots = '•'.repeat(Math.min(14, Math.max(6, p.length)));
  const val = el('span', { class: 'vd-value vd-pw vh-pw-val', text: dots });
  const eye = el('button', { class: 'icon-btn vault-eye', type: 'button',
    text: '👁', title: 'Show ' + label, 'aria-label': 'Show ' + label });
  let shown = false;
  eye.addEventListener('click', () => {
    shown = !shown;
    val.textContent = shown ? p : dots;
    val.classList.toggle('is-open', shown);
    eye.textContent = shown ? '🙈' : '👁';
    eye.title = (shown ? 'Hide ' : 'Show ') + label;
    eye.setAttribute('aria-label', eye.title);
  });
  return el('div', { class: 'vh-pw-row' }, [val, eye, _vaultCopyBtn(label, () => p)]);
}

// ---------- Password history: a dedicated timeline, reached from the
// history icon beside the current password on the detail page. ----------
//
// Broken out of the detail page rather than listed inline there (an earlier
// version did that) because a timeline is a different shape of thing than a
// flat field list - it reads top-to-bottom as "now, then before that, then
// before that", which a label/value row doesn't communicate on its own.
function openVaultPasswordHistory(mod, r) {
  if (!_vaultKey) return;
  const hist = Array.isArray(r.passwordHistory) ? r.passwordHistory : [];

  // "Current" is the timeline's own first entry, not just a header above
  // it - the whole point of a timeline is showing where today's password
  // sits relative to what came before, not just listing the old ones.
  const items = [
    el('div', { class: 'vh-item vh-current' }, [
      el('div', { class: 'vh-dot' }),
      el('div', { class: 'vh-content' }, [
        el('div', { class: 'vh-when' }, [
          el('span', { class: 'vh-current-badge', text: 'Current' }),
          r.updatedAt ? ' · since ' + new Date(r.updatedAt).toLocaleString() : '',
        ]),
        _vaultMaskedRow(r.password, 'the current password'),
      ]),
    ]),
    ...hist.map((h) => el('div', { class: 'vh-item' }, [
      el('div', { class: 'vh-dot' }),
      el('div', { class: 'vh-content' }, [
        el('div', { class: 'vh-when', text: h.changedAt ? new Date(h.changedAt).toLocaleString() : 'Unknown date' }),
        _vaultMaskedRow(h.password, 'this password'),
      ]),
    ])),
  ];

  const back = el('button', {
    class: 'icon-btn vd-back', type: 'button', title: 'Back to the entry', 'aria-label': 'Back to the entry',
    onclick: () => { closeModal(); openVaultDetail(mod, r); },
  }, ['‹']);

  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'vd-head' }, [
        back,
        el('div', { class: 'vd-head-text' }, [
          el('h2', { class: 'vd-title', text: 'Password history' }),
          el('div', { class: 'vd-cat', text: r.title || 'Untitled' }),
        ]),
      ]),
      el('div', { class: 'vh-timeline' }, items),
      el('p', { class: 'hint', text: hist.length
        ? 'Only the last two superseded passwords are kept - an older one is dropped the next time this one changes.'
        : 'Nothing superseded yet - this is the only password this entry has had.' }),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ])]),
  ]));
}
// ---------- The lock screen ----------
function _vaultLockScreen(host, mod, meta) {
  const first = !meta.salt || !meta.verify;
  const pw = el('input', { type: 'password', class: 'vault-master', placeholder: 'Master password',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  const pw2 = el('input', { type: 'password', class: 'vault-master', placeholder: 'Type it again',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  const note = el('p', { class: 'hint vault-note' });
  const meter = el('div', { class: 'vault-meter hidden' }, [
    el('span', { class: 'vault-meter-track' }, [el('span', { class: 'vault-meter-fill' })]),
    el('span', { class: 'vault-meter-lbl' }),
  ]);

  const setNote = (txt, bad) => { note.textContent = txt; note.classList.toggle('warn', !!bad); };

  if (first) {
    // ---- Setting one up ----
    const drawMeter = () => {
      const st = mod.strength(pw.value);
      meter.classList.toggle('hidden', !pw.value);
      meter.querySelector('.vault-meter-fill').style.width = st.pct + '%';
      meter.querySelector('.vault-meter-fill').className = 'vault-meter-fill ' + st.cls;
      meter.querySelector('.vault-meter-lbl').textContent = st.label + ' · ' + st.bits + ' bits';
    };
    pw.addEventListener('input', () => { drawMeter(); setNote(''); });
    pw2.addEventListener('input', () => setNote(''));

    const create = async () => {
      const a = pw.value, b = pw2.value;
      // No length floor and no strength gate. Whose vault it is decides what
      // is worth locking it with; the meter below says what the choice buys
      // and then gets out of the way. The only thing still required is a
      // character - an empty master password would unlock on an empty field,
      // which is not a weak lock but no lock at all.
      if (!a) { setNote('Type something.', true); return; }
      // Typed twice, and that stays. It is not a rule about the password, it
      // is the only guard against a typo in a thing that cannot be recovered.
      if (a !== b) { setNote('The two do not match.', true); return; }
      if (!(await appConfirm('Set this as your master password?\n\nIt is never stored, so if you forget it '
        + 'the vault cannot be opened or recovered by anyone, including you.'))) return;
      // Rows already here were encrypted with a DIFFERENT key - a restored
      // backup from another vault, or a setup that was interrupted. A new
      // master password cannot open them and never will, so the choice is put
      // plainly rather than leaving unreadable rows in a list that looks fine.
      const leftover = (await DB.all('vault').catch(() => [])) || [];
      if (leftover.length) {
        const ok = (await appConfirm(leftover.length + ' encrypted '
          + (leftover.length === 1 ? 'entry is' : 'entries are') + ' already stored here, from an earlier '
          + 'master password.\n\nA new master password cannot open them - there is no way to recover them '
          + 'without the old one.\n\nDelete them and start fresh?'));
        if (!ok) { setNote('Setup cancelled - the existing entries were left alone.', true); return; }
        for (const r of leftover) await DB.del('vault', r.id).catch(() => {});
      }
      const salt = mod.randomSaltB64();
      const key = await mod.deriveKey(a, salt);
      const verify = await mod.makeVerifier(key);
      _vaultKey = key;
      try {
        // The entry goes in BEFORE the salt and verifier are committed. Those
        // two are what make the gate ask to unlock rather than to set up, so
        // writing them first and then failing here leaves the user staring at
        // an unlock screen for a vault that was never created - which is
        // exactly what happened the first time this ran.
        //
        // Kept as an entry too, though never shown as one. It is what fills in
        // the current password when you go to change it, so knowing the vault
        // is open is enough and nobody has to remember it twice. It is not
        // what unlock checks against - that is the verifier - so this copy can
        // only ever be a convenience, never the lock itself.
        await _vaultPut(mod, { title: VAULT_MASTER_TITLE, account: 'My Passwords',
          username: '', password: a, url: '', notes: 'The password that opens this vault.' });
        await DB.put('meta', { key: VAULT_SALT_KEY, value: salt, updatedAt: new Date().toISOString() });
        await DB.put('meta', { key: VAULT_VERIFY_KEY, value: verify, updatedAt: new Date().toISOString() });
      } catch (e) {
        _vaultKey = null;
        setNote('Could not create the vault: ' + (e && e.message ? e.message : e), true);
        return;
      }
      toast('Vault created');
      renderVault();
    };
    pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

    host.appendChild(el('div', { class: 'vault-gate' }, [
      el('div', { class: 'vault-gate-ico', text: '\ud83d\udd10' }),
      el('h2', { class: 'vault-gate-h', text: 'Set a master password' }),
      el('p', { class: 'hint', text: 'One password opens this page. Anything you like - short, long, a word, '
        + 'a phrase. Everything you save here is encrypted with it, on this device.' }),
      pw, meter, pw2, note,
      el('button', { class: 'btn primary vault-go', text: 'Create vault', onclick: create }),
      el('p', { class: 'hint vault-warn', text: '\u26a0 It is never stored anywhere. Forget it and the vault '
        + 'is gone — there is no reset, no recovery, and no way back in.' }),
    ]));
    setTimeout(() => pw.focus(), 60);
    return;
  }

  // ---- Unlocking ----
  //
  // No Submit. Deriving a key takes long enough that doing it on every
  // keystroke would make the field lag, so it runs on a short pause instead -
  // which is also what stops a typo being reported before the word is
  // finished.
  let timer = null;
  let attempt = 0;
  const tryUnlock = async () => {
    const val = pw.value;
    // Anything at all is a valid master password now, so anything at all has
    // to be tried. Waiting for four characters would leave a two-character
    // vault permanently shut.
    if (!val) { setNote(''); return; }
    const mine = ++attempt;
    setNote('Checking...');
    const key = await mod.deriveKey(val, meta.salt);
    if (mine !== attempt) return;         // a newer keystroke has overtaken this
    if (!(await mod.checkVerifier(key, meta.verify))) { setNote('Not that one.', true); return; }
    _vaultKey = key;
    renderVault();
  };
  pw.addEventListener('input', () => {
    setNote('');
    clearTimeout(timer);
    timer = setTimeout(tryUnlock, 320);
  });
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); tryUnlock(); } });

  host.appendChild(el('div', { class: 'vault-gate' }, [
    el('div', { class: 'vault-gate-ico', text: '\ud83d\udd12' }),
    el('h2', { class: 'vault-gate-h', text: 'My Passwords' }),
    el('p', { class: 'hint', text: 'Type your master password. It opens as soon as it is right — '
      + 'there is nothing to press.' }),
    pw, note,
  ]));
  setTimeout(() => pw.focus(), 60);
}

// ---------- The vault's own settings ----------
//
// The three things that act on the whole vault rather than on one entry, put
// behind the single gear in the toolbar. Together, because they are the same
// kind of decision - and because the two CSV ones each need a sentence of
// warning beside them that would never fit on a toolbar button.
//
// Laid out with menuItem, the same as the app's own menu, rather than the
// stack of full-width buttons this had first. Three centred labels with
// left-aligned paragraphs hanging under them lined up with nothing, here or
// anywhere else in the app; a list of actions already has a shape in this
// codebase - icon, name, one line about it, all flush left - and this is a
// list of actions.
function openVaultOptions(mod, meta) {
  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: 'Vault options' }),
      el('div', { class: 'menu-list' }, [
        menuItem('\ud83d\udc65', 'People',
          _vaultPeople.length
            ? _vaultPeople.length + (_vaultPeople.length === 1 ? ' person' : ' people') + ' · '
              + _vaultPeople.join(', ')
            : 'Add the people whose logins live in here',
          () => { closeModal(); openVaultPeople(mod); }),
        menuItem('\ud83d\udd11', 'Change master password',
          'Re-encrypts every entry. The old one stops opening anything',
          () => { closeModal(); openMasterChange(mod, meta); }),
        menuItem('\ud83d\udce4', 'Export to CSV',
          'Every entry as plain readable text, passwords and all',
          () => { closeModal(); vaultExportCsv(mod); }),
        menuItem('\ud83d\udce5', 'Import from CSV',
          'From here, from Chrome, or from another manager',
          () => { closeModal(); vaultImportCsv(mod); }),
      ]),
      el('p', { class: 'hint vault-opt-foot', text: 'CSV is for moving the list into something else, '
        + 'and protects nothing — delete the file once you have used it. To keep the vault safe, '
        + 'use Backup & Restore in the menu: it already includes this vault, encrypted.' }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
      ]),
    ]),
  ]));
}

// ---------- Who the logins belong to ----------
//
// One editable list rather than add/rename/delete as three separate actions:
// the whole point of a rename is that the entries filed under the old name
// follow it, and a delete has to decide what happens to them too. Doing it in
// one pass means the entries are re-encrypted once, after a single confirm
// that says exactly what is about to happen to them.
async function openVaultPeople(mod) {
  if (!_vaultKey) { toast('Unlock the vault first'); return; }
  const { rows } = await _vaultLoad(mod);
  const entries = rows.filter((r) => r.title !== VAULT_MASTER_TITLE);
  const countFor = (name) => entries.filter((r) => r.person === name).length;

  const listEl = el('div', { class: 'vp-list' });
  // Each row remembers the name it started with, so a rename can be told from
  // a delete-and-add and the entries can be moved rather than orphaned.
  let draft = _vaultPeople.map((n) => ({ was: n, now: n }));

  const draw = () => {
    listEl.innerHTML = '';
    if (!draft.length) {
      listEl.appendChild(el('p', { class: 'hint', text: 'Nobody yet. Add a name below.' }));
      return;
    }
    draft.forEach((d, i) => {
      const inp = el('input', { type: 'text', value: d.now, class: 'vp-name',
        autocomplete: 'off', 'aria-label': 'Name' });
      inp.addEventListener('input', () => { d.now = inp.value; });
      const n = d.was ? countFor(d.was) : 0;
      listEl.appendChild(el('div', { class: 'vp-row' }, [
        inp,
        el('span', { class: 'vp-count', text: n ? n + (n === 1 ? ' entry' : ' entries') : 'none yet' }),
        el('button', { class: 'icon-btn vp-del', type: 'button', text: '\u00d7',
          title: 'Remove ' + (d.now || 'this one'), 'aria-label': 'Remove',
          onclick: () => { draft.splice(i, 1); draw(); } }),
      ]));
    });
  };
  draw();

  const addInp = el('input', { type: 'text', class: 'vp-name', placeholder: 'Add a name',
    autocomplete: 'off', 'aria-label': 'Add a name' });
  const addOne = () => {
    const name = addInp.value.trim();
    if (!name) return;
    if (draft.some((d) => d.now.trim().toLowerCase() === name.toLowerCase())) {
      toast('That name is already on the list'); return;
    }
    draft.push({ was: '', now: name });
    addInp.value = '';
    draw();
    addInp.focus();
  };
  addInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });

  const save = async () => {
    const kept = draft.filter((d) => d.now.trim());
    const names = kept.map((d) => d.now.trim());
    const lower = names.map((n) => n.toLowerCase());
    if (lower.some((n, i) => lower.indexOf(n) !== i)) { toast('Two people have the same name'); return; }

    // What this does to the entries, worked out before anything is written.
    const renames = new Map();
    kept.forEach((d) => { if (d.was && d.was !== d.now.trim()) renames.set(d.was, d.now.trim()); });
    const gone = _vaultPeople.filter((n) => !kept.some((d) => d.was === n));
    const orphaned = gone.reduce((a, n) => a + countFor(n), 0);
    const moved = [...renames.keys()].reduce((a, n) => a + countFor(n), 0);

    if (orphaned || moved) {
      const bits = [];
      if (moved) bits.push(moved + (moved === 1 ? ' entry moves' : ' entries move') + ' to the new name');
      if (orphaned) {
        bits.push(orphaned + (orphaned === 1
          ? ' entry loses its owner and goes back to nobody\u2019s'
          : ' entries lose their owner and go back to nobody\u2019s'));
      }
      if (!(await appConfirm('Save these people?\n\n' + bits.join('\n')
        + '\n\nThe entries themselves are untouched otherwise.'))) return;
    }

    // The entries first: a failure here must not leave the list pointing at
    // names the entries no longer carry.
    for (const r of entries) {
      if (!r.person) continue;
      const to = renames.has(r.person) ? renames.get(r.person)
        : (gone.indexOf(r.person) >= 0 ? '' : null);
      if (to === null) continue;
      await _vaultPut(mod, Object.assign({}, r, { person: to }));
    }
    await _vaultSavePeople(mod, names);
    closeModal();
    toast(names.length ? names.length + (names.length === 1 ? ' person saved' : ' people saved') : 'People cleared');
    renderVault();
  };

  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: 'People' }),
      el('p', { class: 'hint', text: 'Who the logins in here belong to. Every entry can be filed under '
        + 'one of them, and the list can then be filtered to one person at a time. Names are encrypted '
        + 'with everything else.' }),
      listEl,
      el('div', { class: 'vp-add' }, [
        addInp,
        el('button', { class: 'btn small primary', type: 'button', text: 'Add', onclick: addOne }),
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn primary', text: 'Save', onclick: save }),
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
      ]),
    ]),
  ]));
}

async function vaultExportCsv(mod) {
  if (!_vaultKey) { toast('Unlock the vault first'); return; }
  const { rows, failed } = await _vaultLoad(mod);
  // Exactly what the list shows, and nothing it does not. Writing a hidden
  // row into a plain file the user never saw on screen is the kind of
  // surprise that belongs in nobody's password manager.
  const out = rows.filter((r) => r.title !== VAULT_MASTER_TITLE);
  if (!out.length) { toast('Nothing to export'); return; }
  if (!(await appConfirm('Export ' + out.length + (out.length === 1 ? ' entry' : ' entries')
    + ' as a plain CSV file?\n\nThe file is NOT encrypted. Every password in it can be read by anyone '
    + 'who opens the file.\n\nSend it where you meant to, then delete it.'))) return;
  // A byte order mark so Excel reads it as UTF-8 instead of mangling anything
  // outside ASCII; the parser on the way back in strips it again.
  const blob = new Blob(['\ufeff' + mod.toCsv(out)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'mynote-passwords-' + todayISO() + '.csv' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(out.length + ' exported to CSV' + (failed ? ' · ' + failed + ' could not be opened' : ''));
}

// Matched on title AND username, never on title alone: two logins to the same
// site is the ordinary case, and merging them would silently destroy one.
// Case and surrounding space are ignored, because a file that has been through
// a spreadsheet regularly comes back with both changed.
const _vaultCsvKey = (r) => String(r.title || '').trim().toLowerCase()
  + '\u0000' + String(r.username || '').trim().toLowerCase();

function vaultImportCsv(mod) {
  if (!_vaultKey) { toast('Unlock the vault first'); return; }
  const input = el('input', { type: 'file', accept: 'text/csv,.csv' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let parsed;
    try { parsed = mod.parseCsv(await file.text()); }
    catch (e) { appAlert('Could not read that file: ' + (e && e.message ? e.message : e)); return; }
    if (!parsed.entries.length) {
      appAlert(parsed.unmatched.length
        ? 'No password column found in that file.\n\nThe columns it has are: ' + parsed.unmatched.join(', ')
          + '\n\nA first line naming the columns is what tells this app which one is which.'
        : 'There are no entries in that file.');
      return;
    }
    const { rows } = await _vaultLoad(mod);
    const have = new Map(rows.map((r) => [_vaultCsvKey(r), r.id]));
    // A row named after the app's own key is refused rather than imported. The
    // stored copy has to keep matching the password that actually opens this
    // vault, and a file cannot change that - only Change master password can.
    const claimed = parsed.entries.filter((e) => e.title === VAULT_MASTER_TITLE).length;
    const incoming = parsed.entries.filter((e) => e.title !== VAULT_MASTER_TITLE);
    if (!incoming.length) { appAlert('That file has nothing in it to import.'); return; }
    let upd = 0;
    incoming.forEach((e) => { if (have.has(_vaultCsvKey(e))) upd++; });
    const add = incoming.length - upd;
    // Counted and shown BEFORE anything is written. An import that turns out
    // to have updated forty rows you meant to add is not undoable.
    if (!(await appConfirm('Import from ' + file.name + '?\n\n'
      + add + ' to add, ' + upd + ' to update'
      + (parsed.skipped ? ', ' + parsed.skipped + ' empty ' + (parsed.skipped === 1 ? 'row' : 'rows')
        + ' ignored' : '')
      + '.\n\nEverything imported is encrypted with your current master password.'
      + (claimed ? '\n\n' + claimed + (claimed === 1 ? ' row is' : ' rows are') + ' named '
        + VAULT_MASTER_TITLE + ' and will be skipped — the password that opens this page is only '
        + 'ever changed from Vault options.' : '')))) return;
    let done = 0;
    let bad = 0;
    for (const e of incoming) {
      const id = have.get(_vaultCsvKey(e));
      try { await _vaultPut(mod, id != null ? Object.assign({ id }, e) : e); done++; }
      catch (_) { bad++; }
    }
    toast(done + ' imported' + (bad ? ' · ' + bad + ' failed' : ''));
    renderVault();
  });
  input.click();
}

// ---------- Changing the master password ----------
//
// Re-derives and RE-ENCRYPTS every row. The old key cannot open anything
// afterwards, which is the point of changing it - a new password that left the
// rows readable by the old one would be theatre.
//
// The current password arrives already filled in and readable. You are inside
// an unlocked vault, which you could only have opened by knowing it, so making
// you type it again proves nothing and only invites the typo that produces
// "that is not the current password" from someone who typed it correctly.
// It is still checked against the verifier before anything is re-encrypted -
// the copy could be stale, and the message says so plainly if it is.
async function openMasterChange(mod, meta) {
  const { rows } = await _vaultLoad(mod);
  const stored = rows.find((r) => r.title === VAULT_MASTER_TITLE);
  const cur = el('input', { type: 'text', class: 'vault-master', placeholder: 'Current master password',
    value: (stored && stored.password) || '', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  const nw = el('input', { type: 'password', class: 'vault-master', placeholder: 'New master password', autocomplete: 'off' });
  const nw2 = el('input', { type: 'password', class: 'vault-master', placeholder: 'Type the new one again', autocomplete: 'off' });
  const note = el('p', { class: 'hint vault-note' });
  const meter = el('div', { class: 'vault-meter hidden' }, [
    el('span', { class: 'vault-meter-track' }, [el('span', { class: 'vault-meter-fill' })]),
    el('span', { class: 'vault-meter-lbl' }),
  ]);
  nw.addEventListener('input', () => {
    const st = mod.strength(nw.value);
    meter.classList.toggle('hidden', !nw.value);
    meter.querySelector('.vault-meter-fill').style.width = st.pct + '%';
    meter.querySelector('.vault-meter-fill').className = 'vault-meter-fill ' + st.cls;
    meter.querySelector('.vault-meter-lbl').textContent = st.label + ' · ' + st.bits + ' bits';
  });

  const save = async () => {
    note.classList.remove('warn');
    const oldKey = await mod.deriveKey(cur.value, meta.salt);
    if (!(await mod.checkVerifier(oldKey, meta.verify))) {
      note.textContent = stored && cur.value === stored.password
        ? 'The copy saved in this vault no longer opens it. Type the master password you actually use.'
        : 'That is not the current password.';
      note.classList.add('warn'); return;
    }
    // No rule about what the new one may be - same as when it was first set.
    // The only thing refused is nothing at all, which would mean no lock.
    if (!nw.value) { note.textContent = 'Type something.'; note.classList.add('warn'); return; }
    if (nw.value !== nw2.value) { note.textContent = 'The two new ones do not match.'; note.classList.add('warn'); return; }

    note.textContent = 'Re-encrypting...';
    const salt = mod.randomSaltB64();
    const key = await mod.deriveKey(nw.value, salt);
    // Read with the OLD key before anything is written, so a failure part way
    // through leaves the vault exactly as it was rather than half converted.
    const raw = (await DB.all('vault').catch(() => [])) || [];
    const opened = [];
    for (const r of raw) {
      const v = await mod.decryptJson(oldKey, r);
      if (v) opened.push({ id: r.id, body: v });
    }
    const rewritten = [];
    let sawMaster = false;
    for (const o of opened) {
      const body = Object.assign({}, o.body);
      // The stored copy of the master password is a copy, so it follows.
      if (body.title === VAULT_MASTER_TITLE) { body.password = nw.value; sawMaster = true; }
      rewritten.push(Object.assign({ id: o.id, updatedAt: new Date().toISOString() },
        await mod.encryptJson(key, body)));
    }
    const verify = await mod.makeVerifier(key);
    // The people list is encrypted with the same key, so it has to be rewritten
    // with the rest or it becomes unreadable the moment the password changes.
    const people = await _vaultLoadPeople(mod).catch(() => []);
    const peopleEnv = people.length ? await mod.encryptJson(key, people) : null;
    for (const row of rewritten) await DB.put('vault', row);
    if (peopleEnv) {
      await DB.put('meta', { key: VAULT_PEOPLE_KEY, value: peopleEnv, updatedAt: new Date().toISOString() });
    }
    await DB.put('meta', { key: VAULT_SALT_KEY, value: salt, updatedAt: new Date().toISOString() });
    await DB.put('meta', { key: VAULT_VERIFY_KEY, value: verify, updatedAt: new Date().toISOString() });
    _vaultKey = key;
    // A vault restored from an old backup, or one that lost the row somehow,
    // gets it back here rather than staying without it forever.
    if (!sawMaster) {
      await _vaultPut(mod, { title: VAULT_MASTER_TITLE, account: 'My Passwords', username: '',
        password: nw.value, url: '', notes: 'The password that opens this vault.' });
    }
    closeModal();
    toast('Master password changed · ' + rewritten.length + ' re-encrypted');
    renderVault();
  };

  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: 'Change master password' }),
      el('p', { class: 'hint', text: 'Every entry is re-encrypted with the new one. The old password will '
        + 'not open anything afterwards, and the new one is no more recoverable than the old.' }),
      el('label', { class: 'vault-lbl', text: stored ? 'Current — filled in from your vault' : 'Current' }),
      cur,
      el('label', { class: 'vault-lbl', text: 'New — anything at all, no rules about length or characters' }),
      nw, meter, nw2, note,
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn primary', text: 'Change it', onclick: save }),
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
      ]),
    ]),
  ]));
}

// ---------- Add / edit an entry ----------
export async function openVaultForm(mod, existing) {
  if (!_vaultKey) return;
  const editing = !!(existing && existing.id != null);
  const f = (ph, val, type) => el('input', {
    type: type || 'text', placeholder: ph, value: val || '',
    autocomplete: 'off', autocapitalize: type ? 'none' : 'sentences', spellcheck: 'false',
  });
  const title = f('Netflix, HDFC net banking, ...', existing && existing.title);
  const account = f('Which account it belongs to', existing && existing.account);
  const username = f('Username, email or customer ID', existing && existing.username, 'text');
  const pw = f('Password', existing && existing.password, 'text');
  const url = f('https://...', existing && existing.url, 'url');
  const notes = el('textarea', { class: 'vault-notes', rows: '3',
    placeholder: 'Security questions, recovery codes, anything else' });
  notes.value = (existing && existing.notes) || '';

  // ---- Category, and the icon that follows from it ----
  //
  // Both optional, and both feed the same preview, so the effect of a choice
  // is visible in the form before it is visible in the list.
  let chosenCat = (existing && existing.category) || '';
  let chosenIcon = (existing && existing.icon) || '';
  const catBtns = [];
  const catGrid = el('div', { class: 'spend-cat-grid' }, mod.VAULT_CATEGORIES.map((c) => {
    const b = el('button', {
      class: 'spend-cat-btn' + (c.name === chosenCat ? ' active' : ''),
      type: 'button', text: c.icon + ' ' + c.name,
    });
    b.addEventListener('click', () => {
      // Tapping the chosen one clears it. A category is optional, so there has
      // to be a way back out of one picked by mistake.
      chosenCat = chosenCat === c.name ? '' : c.name;
      catBtns.forEach((x) => x.classList.toggle('active', x === b && !!chosenCat));
      drawIcon();
    });
    catBtns.push(b);
    return b;
  }));

  // Whose it is. Only offered once there is somebody to pick - the list is
  // made under the gear, and an empty row of chips would just be a puzzle.
  let chosenPerson = (existing && existing.person) || '';
  const personBtns = [];
  const personGrid = el('div', { class: 'spend-cat-grid' }, _vaultPeople.map((name) => {
    const b = el('button', {
      class: 'spend-cat-btn' + (name === chosenPerson ? ' active' : ''), type: 'button', text: name,
    });
    b.addEventListener('click', () => {
      chosenPerson = chosenPerson === name ? '' : name;
      personBtns.forEach((x) => x.classList.toggle('active', x === b && !!chosenPerson));
    });
    personBtns.push(b);
    return b;
  }));

  const icoPrev = el('div', { class: 'vault-ico vault-ico-prev' });
  const icoNote = el('span', { class: 'hint vault-ico-note' });
  const icoGrid = el('div', { class: 'vault-ico-grid hidden' });
  mod.ICON_CHOICES.forEach((e) => {
    const b = el('button', { class: 'vault-ico-pick', type: 'button', text: e });
    b.dataset.ico = e;
    b.addEventListener('click', () => { chosenIcon = chosenIcon === e ? '' : e; drawIcon(); });
    icoGrid.appendChild(b);
  });

  // The way out of a fixed palette. There is no web API that opens a phone's
  // emoji keyboard on demand, and no picker worth writing here would match the
  // one already on the device - so this gives the keyboard somewhere to type
  // into instead, and takes the first emoji that arrives. Whatever the phone
  // can produce works, including the ones the palette leaves out.
  const icoCustom = el('input', {
    type: 'text', class: 'vault-ico-custom', placeholder: 'Tap here, then the emoji key',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
    value: mod.ICON_CHOICES.indexOf(chosenIcon) < 0 ? chosenIcon : '',
  });
  const icoCustomWrap = el('div', { class: 'vault-ico-custom-wrap hidden' }, [
    icoCustom,
    el('p', { class: 'hint', text: 'Any emoji your keyboard can type. The first one is the one used.' }),
  ]);
  const icoCustomNote = icoCustomWrap.querySelector('.hint');
  const ICO_HINT = 'Any emoji your keyboard can type. The first one is the one used.';
  icoCustom.addEventListener('input', () => {
    const g = mod.firstGlyph(icoCustom.value);
    if (g && !mod.isEmoji(g)) {
      // Left in the box rather than deleted from under the typing finger -
      // the note says why nothing happened, and fixing it is one backspace.
      icoCustomNote.textContent = 'That is not an emoji. Use your keyboard\u2019s emoji key.';
      icoCustomNote.classList.add('warn');
      return;
    }
    icoCustomNote.textContent = ICO_HINT;
    icoCustomNote.classList.remove('warn');
    chosenIcon = g;
    drawIcon();
  });
  const icoMore = el('button', {
    class: 'vault-ico-pick is-more', type: 'button', text: '+',
    title: 'Use an emoji from your keyboard', 'aria-label': 'Use an emoji from your keyboard',
  });
  icoMore.addEventListener('click', () => {
    const open = icoCustomWrap.classList.toggle('hidden');
    if (!open) setTimeout(() => icoCustom.focus(), 50);
  });
  icoGrid.appendChild(icoMore);
  const icoToggle = el('button', {
    class: 'btn small ghost', type: 'button', text: 'Pick one',
    onclick: () => icoGrid.classList.toggle('hidden'),
  });
  const icoClear = el('button', {
    class: 'btn small ghost', type: 'button', text: 'Default',
    onclick: () => { chosenIcon = ''; icoCustom.value = ''; drawIcon(); },
  });
  const drawIcon = () => {
    const rec = { title: title.value, url: url.value, category: chosenCat, icon: chosenIcon };
    const ic = mod.iconFor(rec);
    icoPrev.className = 'vault-ico vault-ico-prev' + (ic.emoji ? '' : ' is-letter');
    icoPrev.style.setProperty('--ico-h', mod.iconHue(title.value || ''));
    icoPrev.textContent = ic.emoji || ic.letter;
    icoNote.textContent = chosenIcon ? 'Your pick'
      : 'Chosen from the title' + (chosenCat ? ' and category' : '') + '. Pick one to override it.';
    icoClear.classList.toggle('hidden', !chosenIcon);
    [...icoGrid.children].forEach((b) => b.classList.toggle('active', !!b.dataset.ico && b.dataset.ico === chosenIcon));
    // Lit when the icon in use came from the keyboard rather than the palette,
    // so a chosen icon is never shown with nothing on the grid selected.
    icoMore.classList.toggle('active', !!chosenIcon && mod.ICON_CHOICES.indexOf(chosenIcon) < 0);
  };
  title.addEventListener('input', drawIcon);
  url.addEventListener('input', drawIcon);

  const meter = el('div', { class: 'vault-meter' }, [
    el('span', { class: 'vault-meter-track' }, [el('span', { class: 'vault-meter-fill' })]),
    el('span', { class: 'vault-meter-lbl' }),
  ]);
  const drawMeter = () => {
    const st = mod.strength(pw.value);
    meter.classList.toggle('hidden', !pw.value);
    meter.querySelector('.vault-meter-fill').style.width = st.pct + '%';
    meter.querySelector('.vault-meter-fill').className = 'vault-meter-fill ' + st.cls;
    meter.querySelector('.vault-meter-lbl').textContent = st.label + ' · ' + st.bits + ' bits';
  };
  pw.addEventListener('input', drawMeter);

  // Suggest, rather than impose: it fills the box and can be typed over. 18
  // characters with everything on is comfortably past what any site rejects,
  // and the generator leaves out characters that are hard to read back.
  const suggest = el('button', {
    class: 'btn small primary vault-suggest', type: 'button', text: '\u2728 Suggest strong',
    onclick: () => { pw.value = mod.generatePassword({ length: 18 }); drawMeter(); },
  });

  const save = async () => {
    if (!title.value.trim()) { toast('Give it a title'); return; }
    // A changed password is worth remembering, not just overwritten - the
    // superseded value goes on the front of the history, dated to when it
    // stopped being current, kept to the last TWO. Only fires on an actual
    // edit to a password that was already something; adding one for the
    // first time isn't a "change" with a prior value to keep.
    let passwordHistory = (existing && existing.passwordHistory) || [];
    if (editing && existing.password && pw.value !== existing.password) {
      passwordHistory = [{ password: existing.password, changedAt: new Date().toISOString() }, ...passwordHistory].slice(0, 2);
    }
    await _vaultPut(mod, {
      id: editing ? existing.id : undefined,
      title: title.value.trim(), account: account.value.trim(), username: username.value.trim(),
      password: pw.value, url: url.value.trim(), notes: notes.value,
      category: chosenCat, icon: chosenIcon, person: chosenPerson,
      passwordHistory,
    });
    closeModal();
    toast(editing ? 'Updated' : 'Saved');
    renderVault();
  };
  const del = async () => {
    if (!editing) return;
    if (!(await appConfirm('Delete "' + (existing.title || 'this entry') + '"?\n\nIt cannot be recovered.'))) return;
    await DB.del('vault', existing.id);
    closeModal();
    toast('Deleted');
    renderVault();
  };

  drawMeter();
  drawIcon();
  const btns = [el('button', { class: 'btn primary', text: editing ? 'Save' : 'Add', onclick: save })];
  if (editing) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));

  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: editing ? 'Edit entry' : 'New entry' }),
      field('Title', title),
      el('div', { class: 'field' }, [
        el('label', {}, [el('span', { text: 'Icon' })]),
        el('div', { class: 'vault-ico-row' }, [icoPrev, icoToggle, icoClear, icoNote]),
        icoGrid,
        icoCustomWrap,
      ]),
      el('div', { class: 'field' }, [
        el('label', {}, [el('span', { text: 'Category' })]),
        catGrid,
      ]),
      _vaultPeople.length ? el('div', { class: 'field' }, [
        el('label', {}, [el('span', { text: 'Whose' })]),
        personGrid,
      ]) : document.createTextNode(''),
      field('Account', account),
      field('Username', username),
      el('div', { class: 'field' }, [
        el('label', {}, [el('span', { text: 'Password' })]),
        el('div', { class: 'vault-pw-field' }, [pw, suggest]),
        meter,
      ]),
      field('Website / URL', url),
      field('Notes', notes),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, btns)]),
  ]));
}
