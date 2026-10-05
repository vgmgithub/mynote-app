import { DB } from './db.js';
import { todayISO, num, thisYm, pctClass, fmtPct } from './core.js';
import { ui } from './state.js';
import { isFixedCategory, stepProgress } from './get-started.js';
import { openLoanEntries, openAllocFormForThisYear } from './expense-ui.js';
import { openBond } from './bonds-ui.js';
import { openEmergency } from './ef.js';
import { _eligibleDividendRecords, openDividend } from './divs-ui.js';
import { getUserName, greetingFor, openNameEditor, el, catList, field, toast, round2, closeModal, openModal, b, state, $, _spendableDaysLeft, perDayLabel, renderHomeExpense, modOn, _modsCache, openBackupSheet, setAppMode, getEnabledModules, _homeCard, _walletIcon, _homeLiveRatesStrip, _kittyFor, _perDayBadge, APP_MODULES, moduleIcon, _renewalBanner, liveCountdown, isPaidPlan } from './app.js';
import { sameMoment } from './pay-core.js';
import { homeBetaCard } from './beta-ui.js';
import { pfLoad, pfTotals, _FD_MONS, fmtIntCur, homeInvestedBreakdown, openInvestedBreakdown, UPCOMING_DAYS } from './personal-ui.js';

// End-of-page caution: data lives only on this device, so backups matter.
// Shows how long ago the last one was, and turns amber when it is overdue.
async function _homeBackupCaution() {
  const last = await DB.get('meta', 'lastBackup').catch(() => null);
  const at = last && last.value ? Number(last.value) : 0;
  const days = at ? Math.floor((Date.now() - at) / 86400000) : null;
  const overdue = days === null || days >= 7;
  let status;
  if (days === null) status = 'You have not taken a backup yet';
  else if (days === 0) status = 'Last backup: today';
  else status = 'Last backup: ' + new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    + ' (' + days + (days === 1 ? ' day' : ' days') + ' ago)';
  // Collapsed to one line; tap it to see the details, the last backup and the button.
  const card = el('div', { class: 'home-caution' + (overdue ? ' is-overdue' : '') });
  const head = el('button', { class: 'home-caution-head', type: 'button', 'aria-expanded': 'false' }, [
    el('span', { class: 'home-caution-ico', text: overdue ? '⚠️' : '🛡️' }),
    el('span', { class: 'home-caution-title', text: 'Back up often to stay safe' }),
    el('span', { class: 'home-caution-chev', text: '›' }),
  ]);
  head.addEventListener('click', () => {
    const open = card.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
  });
  card.appendChild(head);
  card.appendChild(el('div', { class: 'home-caution-body' }, [
    el('p', { class: 'home-caution-text', text:
      'Everything you enter lives only on this phone - nothing is stored online. If the phone is lost, reset or the app data is cleared, your records cannot be recovered. Take a backup regularly, and always after adding new entries.' }),
    el('p', { class: 'backup-tip', text: '💡 Also save a copy of your backup to Google Drive (or email it to yourself). A backup kept only on this phone is lost with it.' }),
    el('div', { class: 'home-caution-foot' }, [
      el('span', { class: 'home-caution-status', text: status }),
      el('button', { class: 'btn small home-caution-btn', type: 'button', text: 'Back up now', onclick: () => openBackupSheet() }),
    ]),
  ]));
  return card;
}

// The "your plan ends soon" card. Set by app.js's mynote-plan-notice listener (_renewalBanner in app.js),
// which is the only source for this - there is no other way for the app to learn a term is ending, since
// there is no push notification here. A card rather than a toast because a toast is gone in four seconds
// and a subscription running out is worth more attention than that; it stays on Home until the date
// passes (the plan itself then changes, which clears it) or the person dismisses it.
// The words for the card and the reminder toast. Within two days the time matters too (and under the
// billing test clock a term lasts minutes). Cancelled-but-paid-up does not auto-renew, so that one
// says so; a mandate still running needs nothing from anybody, so it only says when.
export function renewalMessage(n) {
  const when = new Date(n && n.endsAt);
  if (isNaN(when)) return '';
  const pretty = when.getTime() - Date.now() < 2 * 864e5
    ? when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : when.toLocaleDateString('en-IN', { dateStyle: 'medium' });
  return n.cancelled ? 'Your Pro Plan ends ' + pretty + ' and won’t renew.' : 'Your Pro Plan renews ' + pretty + '.';
}

// Puts the card on Home now, in its place under the header, without redrawing Home - so an open form or
// the guided setup on top is not disturbed, and the card is there the moment they close. A card already
// up for the same term is left alone (its countdown keeps running); one for another term slides out.
export function mountRenewalCard() {
  const host = $('#homeView');
  if (!host || state.appMode !== 'home') return;
  // Home is being drawn (emptied, header not back yet): renderHome puts the card in itself, and checks again when
  // it finishes. Mounting here put one at the very top and renderHome then added its own, so it showed twice.
  if (!host.querySelector('.home-hero')) return;
  const n = _renewalBanner.current;
  const shown = [...host.querySelectorAll('.home-renew-wrap:not(.is-leaving)')];
  if (n && shown.some((w) => sameMoment(w.dataset.ends, n.endsAt))) return;
  shown.forEach(_leaveRenewalCard);
  const card = _homeRenewalCard();
  if (!card) return;
  const head = host.firstElementChild;
  host.insertBefore(card, head ? head.nextSibling : null);
  _enterRenewalCard(card);
}

// In: the space opens, then the card settles into it (a grid row growing from 0fr, so the rest of Home
// glides down rather than jumping). Only the first time a term's card appears; Home repaints often
// (any edit) and a card that slid in once stays put after that.
function _enterRenewalCard(wrap) {
  if (!wrap) return;
  const n = _renewalBanner.current;
  const first = !(n && sameMoment(n.endsAt, _renewalBanner.animatedFor));
  if (n) _renewalBanner.animatedFor = n.endsAt;
  const still = !first || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (still) { wrap.classList.add('is-in'); return; }
  // One forced layout in the closed state, then the open one: the browser has a "from" to animate from.
  // Not requestAnimationFrame - it does not run while the page is hidden, and the card would wait unseen.
  void wrap.offsetHeight;
  wrap.classList.add('is-in');
}
// Out: the card lifts and fades while the space closes, then it is removed.
function _leaveRenewalCard(wrap) {
  if (!wrap || !wrap.isConnected || wrap.classList.contains('is-leaving')) return;
  wrap.classList.add('is-leaving');
  wrap.classList.remove('is-in');
  let gone = false;
  const done = () => { if (!gone) { gone = true; wrap.remove(); } };
  wrap.addEventListener('transitionend', (e) => { if (e.target === wrap && e.propertyName === 'grid-template-rows') done(); });
  setTimeout(done, 700);
}

const _RENEW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.2V13l2.6 1.7"/><path d="M9.5 3.2h5"/></svg>';

// The card itself: an icon, what is happening in words, when (with a countdown that ticks), and a thin
// bar along the bottom that drains across the warning window. Blue while the plan renews on its own,
// amber when it will not, and amber for everyone in the last stretch.
function _homeRenewalCard() {
  const n = _renewalBanner.current;
  if (!n || !n.endsAt || sameMoment(n.endsAt, _renewalBanner.dismissedFor)) return null;
  const when = new Date(n.endsAt);
  const left0 = when.getTime() - Date.now();
  if (isNaN(when) || left0 <= 0) return null;
  const windowMs = n.windowMs > 0 ? Math.max(n.windowMs, left0) : left0;
  const pretty = left0 < 2 * 864e5
    ? when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : when.toLocaleDateString('en-IN', { dateStyle: 'medium' });
  const ico = el('span', { class: 'home-renew-ico', 'aria-hidden': 'true' });
  ico.innerHTML = _RENEW_ICON;
  const fill = el('i');
  const urgentMs = Math.min(60e3, windowMs * 0.25);
  let card = null;
  const wrap = el('div', { class: 'home-renew-wrap', 'data-ends': n.endsAt });
  const count = liveCountdown(n.endsAt, {
    onTick: (left) => {
      fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / windowMs)).toFixed(4) + ')';
      if (card) card.classList.toggle('is-urgent', left <= urgentMs);
    },
    // The term is over: the card leaves (the ended popup follows from the plan check a moment later).
    onEnd: () => _leaveRenewalCard(wrap),
  });
  const x = el('button', { class: 'home-renew-x', type: 'button', 'aria-label': 'Dismiss', text: '×' });
  card = el('div', { class: 'home-renew' + (n.cancelled ? ' is-ending' : '') + (left0 <= urgentMs ? ' is-urgent' : ''), role: 'status' }, [
    ico,
    el('div', { class: 'home-renew-body' }, [
      el('div', { class: 'home-renew-title', text: n.cancelled ? 'Your Pro Plan ends soon' : 'Your Pro Plan renews soon' }),
      el('div', { class: 'home-renew-sub' }, [
        el('span', { text: (n.cancelled ? 'Ends ' : 'Renews ') + pretty + (n.cancelled ? ' · won’t renew' : '') }),
        count,
      ]),
    ]),
    x,
    el('div', { class: 'home-renew-bar', 'aria-hidden': 'true' }, [fill]),
  ]);
  fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left0 / windowMs)).toFixed(4) + ')';
  x.addEventListener('click', () => {
    _renewalBanner.dismissedFor = n.endsAt;       // for this session only: it comes back when the app is reopened
    _leaveRenewalCard(wrap);
  });
  wrap.appendChild(el('div', { class: 'home-renew-clip' }, [card]));
  return wrap;
}

// "Get started": the first pass through the app, in the order that builds good money habits (see get-started.js).
// Each card says what to do in one line and goes straight there; a card vanishes once it is done, optional
// ones can be skipped, and a backup is always the last. The card disappears when nothing is left.
async function _homeGettingStarted() {
  const paid = isPaidPlan();
  const ym = todayISO().slice(0, 7), year = Number(ym.slice(0, 4));
  const all = (store) => DB.all(store).then((r) => r || []).catch(() => []);
  const [allocs, emergency, sheetRow, spends, stocks, funds, fds, metals, bonds, people, checks, cards, pSpends, banks, vault, skipRow, last, allSetRow] = await Promise.all([
    all('allocations'), all('emergency'), DB.get('monthlySheet', ym).catch(() => null), all('spends'),
    all('stocks'), all('funds'), all('fds'), all('metals'), all('bonds'), all('healthPeople'), all('healthChecks'),
    all('creditCards'), all('personalSpends'), all('bankSavings'), all('vault'),
    DB.get('meta', 'getStartedSkipped').catch(() => null), DB.get('meta', 'lastBackup').catch(() => null),
    DB.get('meta', 'getStartedAllSet').catch(() => null),
  ]);
  // Closed once already: this device has been through Get Started to the end, so it is an existing user, not
  // someone still filling in the first pages. A feature switched on later must not resurrect the whole card,
  // onboarding-style, for somebody who is clearly already using the app.
  if (allSetRow && allSetRow.value) return null;
  const fixedItems = ((catList('spend') || []).find((g) => g.group === 'Fixed') || {}).items || [];
  const isFixed = (s) => isFixedCategory(fixedItems, s.category);
  const loansThisMonth = !!(sheetRow && ((Array.isArray(sheetRow.loanItems) && sheetRow.loanItems.length > 0) || parseFloat(sheetRow.loan) > 0));
  const done = new Set();
  if (allocs.some((a) => Number(a.year) === year && Number(a.salary) > 0)) done.add('plan');
  if (emergency.some((r) => r.kind === 'contribution') && emergency.some((r) => r.kind === 'target')) done.add('ef');
  if (loansThisMonth) done.add('loans');
  if (spends.some(isFixed)) done.add('fixed');
  if (stocks.length || funds.length || fds.length || metals.length || bonds.length) done.add('invest');
  if (people.length && checks.length) done.add('health');
  if (cards.length) done.add('cc');
  if (spends.some((s) => !isFixed(s))) done.add('daily');
  if (pSpends.length) done.add('personal');
  if (banks.length) done.add('banksav');
  if (vault.length) done.add('vault');
  // Analysis has something to say once two months hold spending (Review's own minimum); the calculators count as
  // tried once opened (meta calcUsed, set by the Calculators screen).
  const spentMonths = new Set(spends.concat(pSpends).map((s) => String(s.ym || '').slice(0, 7)).filter(Boolean));
  if (spentMonths.size >= 2) done.add('analysis');
  if (await DB.get('meta', 'calcUsed').catch(() => null)) done.add('calc');
  const skipped = new Set(skipRow && Array.isArray(skipRow.value) ? skipRow.value : []);
  const progress = stepProgress({ on: (m) => modOn(_modsCache, m), paid, done, skipped, backedUp: !!(last && last.value) });
  const todo = progress.todo;
  // Nothing left: the first-time celebration, shown once and never again (see the allSetRow check above).
  if (!todo.length) return _homeAllSet(progress);

  // What a card does when tapped. Money screens open on the tab where the work is.
  const openExpense = (tab) => () => { ui._expTab = tab; setAppMode('expense'); };
  const go = {
    // Free Plan: land on the Yearly plan tab AND open this year's form, so the first step is already in front of them.
    plan: () => { ui._expTab = 'alloc'; setAppMode('expense'); setTimeout(() => openAllocFormForThisYear(), 450); },
    ef: () => openEmergency(),
    loans: () => { ui._expTab = 'spend'; setAppMode('expense'); setTimeout(() => openLoanEntries(), 450); },
    fixed: openExpense('tracker'),
    invest: () => setAppMode('investment'),
    health: () => setAppMode('health'),
    cc: () => setAppMode('cc'),
    daily: openExpense('tracker'),
    personal: () => setAppMode('personal'),
    banksav: () => setAppMode('banksav'),
    vault: () => setAppMode('vault'),
    analysis: () => setAppMode('analysis'),
    calc: () => setAppMode('calc'),
    backup: () => openBackupSheet(),
  };
  const skip = async (id) => {
    await DB.put('meta', { key: 'getStartedSkipped', value: [...skipped, id] }).catch(() => {});
    renderHome();
  };
  // One card at a time, swiped sideways; the next card peeks in so it is clear there is more.
  const modOf = (id) => APP_MODULES.find((m) => m.id === id);
  const track = el('div', { class: 'home-start-track' }, todo.map((t, n) => {
    const m = t.mod ? modOf(t.mod) : null;
    const card = el('div', { class: 'home-start-card', role: 'button', tabindex: '0' }, [
      el('span', { class: 'home-start-ico' }, [m ? moduleIcon(m) : document.createTextNode(t.icon || '\u2728')]),
      el('span', { class: 'home-start-body' }, [
        el('span', { class: 'home-start-step', text: 'Step ' + progress.place(t.id) + ' of ' + progress.total }),
        el('span', { class: 'home-start-label', text: t.title }),
        el('span', { class: 'home-start-hint', text: t.hint }),
      ]),
      el('span', { class: 'home-start-go', text: '\u203A' }),
    ]);
    const open = go[t.id];
    card.addEventListener('click', () => { if (open) open(); });
    card.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); open(); } });
    if (t.skippable) {
      card.appendChild(el('span', {
        class: 'home-start-skip', role: 'button', text: 'Skip', title: 'Skip this optional step',
        onclick: (e) => { e.stopPropagation(); skip(t.id); },
      }));
    }
    return card;
  }));
  const dots = el('div', { class: 'home-start-dots' }, todo.map((_, n) => el('span', { class: 'home-start-dot' + (n === 0 ? ' on' : '') })));
  track.addEventListener('scroll', () => {
    const first = track.firstElementChild;
    const w = first ? first.getBoundingClientRect().width + 10 : 1;
    const at = Math.max(0, Math.min(todo.length - 1, Math.round(track.scrollLeft / w)));
    [...dots.children].forEach((d, n) => d.classList.toggle('on', n === at));
  }, { passive: true });
  const title = el('span', { class: 'home-start-title', text: '✨ Get started' });
  const stepCount = el('span', { class: 'home-start-count', text: progress.completed + ' of ' + progress.total + ' completed' });
  const bar = _homeStartBar(progress);
  const body = el('div', { class: 'home-start-bodywrap' }, [track, todo.length > 1 ? dots : null].filter(Boolean));
  // Free Plan: the card is always open, as before.
  if (!isPaidPlan()) {
    return el('div', { class: 'home-start' }, [el('div', { class: 'home-start-head' }, [title, stepCount]), bar, body]);
  }
  // Pro Plan: the card folds down to its first row (title, count and a double arrow); tap to open or close.
  // The choice is remembered on this device only, and the card starts folded.
  const KEY = 'mynoteStartOpen';
  const saved = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
  const arrows = el('span', { class: 'home-start-arrows', 'aria-hidden': 'true' });
  arrows.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5,3 8,7.5 12.5,3"/><polyline points="3.5,8.5 8,13 12.5,8.5"/></svg>';
  const head = el('button', { class: 'home-start-head is-toggle', type: 'button', 'aria-expanded': 'false' }, [title, el('span', { class: 'home-start-right' }, [stepCount, arrows])]);
  // The bar stays in sight when the card is folded: how far along they are is the one thing worth a glance.
  const card = el('div', { class: 'home-start is-collapsible' }, [head, bar, body]);
  const setOpen = (open) => {
    card.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  setOpen(saved());
  head.addEventListener('click', () => {
    const open = !card.classList.contains('open');
    setOpen(open);
    try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (_) { /* remembering is optional */ }
  });
  return card;
}

// Each renderHome call takes a number; one that a newer call has overtaken stops at its next await. Two calls
// close together (a plan change and the screen redraw, say) used to both empty Home and both fill it.
let _homeGen = 0;
// The thin bar under the Get started title. Home is redrawn after almost every edit, so it grows from where it was
// last drawn in this session (from empty the first time), never from zero on each redraw.
let _homeStartPct = 0;
function _homeStartBar(progress) {
  const pct = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const fill = el('i', { style: 'width:' + _homeStartPct + '%' });
  const bar = el('div', { class: 'home-start-progress', role: 'progressbar', 'aria-label': 'Get started progress',
    'aria-valuemin': '0', 'aria-valuemax': String(progress.total), 'aria-valuenow': String(progress.completed) }, [fill]);
  const from = _homeStartPct;
  _homeStartPct = pct;
  if (from === pct) return bar;
  // Grown once it is on the page: a forced layout gives the transition its "from" (rAF does not run while hidden).
  setTimeout(() => { if (bar.isConnected) { void bar.offsetWidth; fill.style.width = pct + '%'; } else fill.style.width = pct + '%'; }, 30);
  return bar;
}

// Every step done: a small celebration in the Get started card's place, shown once and closed with the × -
// nothing but the message itself, since the step count and progress bar have nothing left to say once every
// step is done. The confetti runs once per app open, not on every redraw.
let _homeAllSetPlayed = false;
const _CONFETTI = [
  ['-54px', '-38px', '220deg', '#f59e0b'], ['-18px', '-52px', '-160deg', '#8b5cf6'], ['26px', '-46px', '280deg', '#10b981'],
  ['58px', '-22px', '-240deg', '#ef4444'], ['64px', '18px', '200deg', '#3b82f6'], ['30px', '40px', '-200deg', '#f59e0b'],
  ['-12px', '46px', '260deg', '#ec4899'], ['-48px', '30px', '-220deg', '#10b981'], ['-66px', '-4px', '180deg', '#3b82f6'],
  ['8px', '-60px', '-280deg', '#ec4899'],
];
function _homeAllSet(progress) {
  const still = _homeAllSetPlayed || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  _homeAllSetPlayed = true;
  _homeStartPct = 100;
  const x = el('button', { class: 'home-done-x', type: 'button', 'aria-label': 'Close', title: 'Close', text: '\u00d7' });
  const card = el('div', { class: 'home-start is-done' + (still ? ' is-still' : ''), role: 'status' }, [
    el('div', { class: 'home-done' }, [
      el('span', { class: 'home-done-confetti', 'aria-hidden': 'true' },
        _CONFETTI.map(([cx, cy, r, c]) => el('i', { style: '--x:' + cx + ';--y:' + cy + ';--r:' + r + ';--c:' + c }))),
      el('span', { class: 'home-done-pop', 'aria-hidden': 'true', text: '\u{1F389}' }),
      el('div', { class: 'home-done-text' }, [
        el('div', { class: 'home-done-title', text: 'You’re all set!' }),
        el('div', { class: 'home-done-sub', text: 'MyNotes will start turning your records into useful insights.' }),
      ]),
    ]),
    x,
  ]);
  x.addEventListener('click', async () => {
    await DB.put('meta', { key: 'getStartedAllSet', value: progress.ids }).catch(() => {});
    card.classList.add('is-leaving');
    setTimeout(() => card.remove(), 320);
  });
  return card;
}

export async function renderHome() {
  const host = $('#homeView');
  const gen = ++_homeGen;
  const stale = () => gen !== _homeGen;
  await getEnabledModules();
  if (stale()) return;
  host.innerHTML = '';
  // Two columns: who this is on the left, when it is on the right. The date
  // and what is left of the month are the only things on Home that change on
  // their own, so they sit apart from the name rather than under it.
  const _hDays = _spendableDaysLeft(todayISO().slice(0, 7));
  const _hNow = new Date();
  const _hName = await getUserName();
  if (stale()) return;
  // Everything that used to be the Home hero now lives in the header: greeting under the app name, and
  // today / days left / version on the right (in place of the menu dots - Settings is in the bottom bar).
  // An empty .home-hero stays as the anchor other Home cards are mounted after.
  const sub = document.querySelector('#appTitle .head-sub');
  if (sub) {
    sub.innerHTML = '';
    sub.appendChild(_hName
      ? el('button', { class: 'head-greet', type: 'button', title: 'Tap to change your name', text: '👋 ' + greetingFor(_hName, _hNow), onclick: openNameEditor })
      : el('span', { class: 'head-greet', text: '🔒 Your data never leaves this device' }));
  }
  const right = document.getElementById('homeHeadRight');
  if (right) {
    right.innerHTML = '';
    right.append(
      el('div', { class: 'home-today', text: _hNow.getDate() + ' ' + _FD_MONS[_hNow.getMonth()] }),
      el('div', { class: 'home-days' + (_hDays <= 5 ? ' is-tight' : ''), title: perDayLabel(_hDays), text: _hDays + (_hDays === 1 ? ' day left' : ' days left') }),
    );
  }
  host.appendChild(el('div', { class: 'home-hero is-head' }));

  // A term running out outranks even Get Started - it is time-sensitive in a way nothing else on Home is.
  try { const rc = _homeRenewalCard(); if (rc) host.appendChild(rc); _enterRenewalCard(rc); } catch (_) {}
  // Friday-Sunday, unsubmitted: the same "don't nag once it's done" rule as the renewal card above.
  try { const bc = await homeBetaCard(); if (bc && !stale()) host.appendChild(bc); } catch (_) {}
  // Right under the title: the first thing a new user should see.
  try { const gs = await _homeGettingStarted(); if (gs && !stale()) host.appendChild(gs); } catch (_) {}
  if (stale()) return;
  refreshHomeFabRings();

  // Calculate total invested and earned across Stocks, Mutual Funds, Fixed Deposits, and Metals
  const breakdown = await homeInvestedBreakdown();
  if (stale()) return;
  const totalInvested = breakdown.totalInvested;
  const totalValue = breakdown.totalValue;

  // Earned is derived from the exact same (filtered) invested/value totals above -
  // same stocks + funds included, nothing computed on a separate dataset.
  const totalEarned = totalValue - totalInvested;
  const totalEarnedPct = totalInvested > 0 ? (totalEarned / totalInvested) * 100 : 0;
  const summaryCard = el('div', { class: 'home-summary' }, [
    el('div', { class: 'summary-stat' }, [
      el('div', { class: 'stat-label' }, [
        'Total Invested',
        el('button', {
          class: 'info-btn', type: 'button', 'aria-label': 'What makes up Total Invested',
          title: 'What makes up this figure', text: 'i',
          onclick: (e) => { e.stopPropagation(); openInvestedBreakdown(breakdown); },
        }),
      ]),
      el('div', { class: 'stat-value', text: fmtIntCur(totalInvested) }),
    ]),
    el('div', { class: 'summary-stat' }, [
      el('div', { class: 'stat-label', text: 'Total Earned' }),
      el('div', { class: 'stat-value' }, [fmtIntCur(totalEarned) + ' ', el('span', { class: 'summary-badge ' + pctClass(totalEarnedPct), text: fmtPct(totalEarnedPct) })]),
    ]),
  ]);
  // No investment feature chosen -> no investment totals to show.
  if (modOn(_modsCache, 'stocks') || modOn(_modsCache, 'mf') || modOn(_modsCache, 'fd') || modOn(_modsCache, 'metal') || modOn(_modsCache, 'bond')) {
    host.appendChild(summaryCard);
  }

  // Upcoming FD maturities + bond payouts, above the section cards. Wrapped
  // because a failure here must never blank Home - same defensive stance as the
  // live-stats blocks.
  try {
    const soon = await _homeUpcomingStrip();
    if (soon && !stale()) host.appendChild(soon);
  } catch (_) {}
  if (stale()) return;

  // Subtitles list what's actually behind each card, in the order the section
  // itself lists them.
  const _subFor = (pairs) => {
    const m = _modsCache;
    return pairs.filter(([id]) => modOn(m, id)).map(([, label]) => label).join(' · ');
  };
  const investmentCard = _homeCard('💼', 'Investment',
    _subFor([['stocks', 'Stocks'], ['mf', 'MF'], ['fd', 'FD'], ['metal', 'Metals'], ['bond', 'Bonds']]),
    () => setAppMode('investment'));
  const savingsCard = _homeCard('🏦', 'Savings',
    _subFor([['ef', 'Emergency Fund'], ['div', 'Dividends'], ['banksav', 'Bank Savings'], ['calc', 'Calculators']]),
    () => setAppMode('savings'));
  // Two different taps, two different destinations:
  //  - the card itself (title/subtitle/chevron) opens on whichever tab was
  //    last open there (_expTab persists across navigation, defaulting to
  //    Credit Card - its declared initial value - the first time this is
  //    ever opened) - the normal "go back to where I left off" behaviour.
  //  - the 💳 ICON specifically is its own "check my funds and balance"
  //    shortcut, always landing on Balance regardless of _expTab, since
  //    that's the one figure worth a dedicated one-tap route to.
  // The icon's own listener stops the click from also reaching the card's -
  // without that, tapping the icon would fire both and Balance would win by
  // running last, which happens to look right today but is fragile.
  const expenseCard = _homeCard('🛒', 'House Expense', 'Balance · Tracker · Category spend · Tags', () => setAppMode('expense'));
  expenseCard.querySelector('.home-card-ico').addEventListener('click', (e) => {
    e.stopPropagation();
    ui._expTab = 'spend';
    setAppMode('expense');
  });
  expenseCard.dataset.homeCard = 'expense';
  const ccCard = _homeCard('💳', 'Credit Cards', 'Cards · Heatmap · Category spend · Card check', () => setAppMode('cc'));
  const personalCard = _homeCard(_walletIcon(), 'Personal Finance', 'Own spends · card & UPI / cash limits', () => setAppMode('personal'));
  personalCard.dataset.homeCard = 'personal';
  // Analysis reads whichever spending features are on; the subtitle says which, plus the AI prompt it can build.
  const analysisCard = _homeCard('\u{1F50E}', 'Analysis',
    [_subFor([['expense', 'Household'], ['personal', 'Personal']]), 'AI prompt'].filter(Boolean).join(' · '),
    () => setAppMode('analysis'));
  const healthCard = _homeCard(el('img', { class: 'home-card-beat', src: 'icons/health-card.png', alt: '', style: 'width: 30px; height: 30px; display: block;' }), 'Health Check', 'Medical records · Family history', () => setAppMode('health'));
  const vaultCard = _homeCard('\ud83d\udd10', 'My Passwords', 'Locked · encrypted on this device', () => setAppMode('vault'));
  const _mods = await getEnabledModules();
  if (stale()) return;
  const _on = (...ids) => ids.some((id) => modOn(_mods, id));
  const _homeCards = [
    _on('stocks', 'mf', 'fd', 'metal', 'bond') ? investmentCard : null,
    _on('expense') ? expenseCard : null,
    _on('personal') ? personalCard : null,
    _on('cc') ? ccCard : null,
    _on('analysis') ? analysisCard : null,
    _on('ef', 'div', 'banksav', 'calc') ? savingsCard : null,
    _on('health') ? healthCard : null,
    _on('vault') ? vaultCard : null,
  ].filter(Boolean);
  host.appendChild(el('div', { class: 'home-cards' }, _homeCards));

  // Wrapped like the upcoming strip above - three boxes hitting two external
  // APIs must never be the reason Home fails to render.
  // The rates strip and the backup card sit together at the BOTTOM of Home, even when only a few feature
  // cards are on: Home is a full-height column (styles.css) and this group takes the space left above it.
  const homeBottom = el('div', { class: 'home-bottom' });
  host.appendChild(homeBottom);
  // Fill the screen from wherever Home starts (below the header, whose height varies with the notch), so
  // the bottom group can sit at the bottom. With more cards than fit, Home simply scrolls as before.
  // The container's own bottom padding is taken off too, or a short Home would still scroll by that much.
  const _hostTop = Math.round(host.getBoundingClientRect().top + window.scrollY);
  const _outerPad = host.parentElement ? parseFloat(getComputedStyle(host.parentElement).paddingBottom) || 0 : 0;
  host.style.minHeight = 'calc(100dvh - ' + Math.max(0, Math.round(_hostTop + _outerPad)) + 'px)';
  try {
    const live = await _homeLiveRatesStrip();
    if (!stale()) homeBottom.appendChild(live);
  } catch (_) {}
  if (stale()) return;

  const caution = await _homeBackupCaution();
  if (stale()) return;
  homeBottom.appendChild(caution);

  // Per-day room on the two cards that have a budget behind them. Wrapped, and
  // last, for the same reason the investment stats are: a failure reading one
  // of these must leave Home standing rather than blank it.
  try {
    await refreshHomePerDay(host);
  } catch (_) { /* Home stands without it */ }
  if (stale()) return;
  // One renewal card, under the header: extra copies from anything that raced this render go, and a reminder
  // that arrived while Home was being drawn (mountRenewalCard waited for it) is put in now.
  [...host.querySelectorAll('.home-renew-wrap:not(.is-leaving)')].slice(1).forEach((w) => w.remove());
  mountRenewalCard();
  _homeFabClearance(host);
}

// The add-spend buttons float over the bottom-right corner. Space is added under
// the last card ONLY when the page already scrolls - on a page that fits, extra
// space would just create a pointless scroll.
function _homeFabClearance(host) {
  host.classList.remove('has-fabs');
  host.style.paddingBottom = '';
  // The rates strip and backup card now sit at the bottom of Home (renderHome's home-bottom), so the
  // floating Home bar would always cover the backup card: Home keeps room for the bar's real height.
  const nav = document.getElementById('homeNav');
  // offsetParent is always null for a fixed element, so visibility is read from its box instead.
  const navBox = nav ? nav.getBoundingClientRect() : null;
  const navTop = navBox && navBox.height > 0 && getComputedStyle(nav).display !== 'none' ? navBox.top : null;
  if (navTop != null && navTop < window.innerHeight) host.style.paddingBottom = Math.round(window.innerHeight - navTop + 12) + 'px';
  if (!(modOn(_modsCache, 'expense') || modOn(_modsCache, 'personal'))) return;
  const bottom = host.getBoundingClientRect().bottom + window.scrollY;
  if (bottom > window.innerHeight) host.classList.add('has-fabs');
}
// ---------- SIP done, from Home ----------
//
// Tapping a SIP card on Coming Up opens this instead of leaving Home. It lists the fund, and "SIP done"
// records the instalment right there: two boxes, units bought and the NAV, and the date and amount are
// filled in from the reminder.
//
// It adds one row to the fund's own `contributions` (the same list the fund form edits), as a 'buy' dated
// on the SIP day, so Holdings, XIRR and the projections all pick it up with no special case. Nothing new
// is stored and no schema changes.
async function openSipDoneSheet(fund, reminder) {
  const mod = await import('./mf.js');
  const c = mod.computeFund(fund, Date.now());
  const row = (k, v) => el('div', { class: 'sip-row' }, [el('span', { text: k }), el('b', { text: v })]);
  const units = c.totalUnits > 0 ? (Math.round(c.totalUnits * 1000) / 1000) + ' units' : 'none yet';
  const details = el('div', { class: 'sip-details' }, [
    row('SIP amount', fmtIntCur(reminder.amount)),
    row('Due', _shortDayMon(reminder.date) + (reminder.days <= 0 ? ' \u00b7 today' : reminder.days === 1 ? ' \u00b7 tomorrow' : ' \u00b7 in ' + reminder.days + ' days')),
    fund.type ? row('Type', fund.type + (fund.category ? ' \u00b7 ' + fund.category : '')) : null,
    row('Invested so far', fmtIntCur(c.invested)),
    row('Units held', units),
    c.avgNav != null ? row('Average NAV', '\u20b9' + c.avgNav.toFixed(2)) : null,
    c.latestNav != null ? row('Latest NAV', '\u20b9' + c.latestNav.toFixed(2) + (fund.navAsOf ? ' \u00b7 ' + _shortDayMon(fund.navAsOf) : '')) : null,
    c.valueSource === 'nav' ? row('Current value', fmtIntCur(c.value) + '  (' + (c.absReturnPct >= 0 ? '+' : '') + c.absReturnPct.toFixed(1) + '%)') : null,
  ].filter(Boolean));

  // Already recorded for this date (say, from the fund form, or a second tap): say so rather than
  // adding it twice.
  const already = (fund.contributions || []).some((x) => x.type !== 'sell' && x.date === reminder.date);

  const unitsInp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', placeholder: 'e.g. 12.345', id: 'sipUnits' });
  const navInp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', placeholder: c.latestNav != null ? String(c.latestNav) : 'NAV on the day', id: 'sipNav' });
  // Units are the amount divided by the NAV, so once the NAV is typed the units are suggested - and they
  // stop being suggested the moment somebody types their own (a statement's units differ slightly).
  let unitsTouched = false;
  unitsInp.addEventListener('input', () => { unitsTouched = true; });
  navInp.addEventListener('input', () => {
    const n = num(navInp.value);
    if (!unitsTouched && n && n > 0) unitsInp.value = String(Math.round((reminder.amount / n) * 1000) / 1000);
    if (!unitsTouched && !(n > 0)) unitsInp.value = '';
  });

  const form = el('div', { class: 'sip-form', hidden: 'hidden' }, [
    el('p', { class: 'hint', text: 'Look at the SIP confirmation for the units and the NAV. The date (' + _shortDayMon(reminder.date) + ') and amount (' + fmtIntCur(reminder.amount) + ') are filled in for you.' }),
    field('NAV', navInp),
    field('Units purchased', unitsInp),
  ]);
  const doneBtn = el('button', { class: 'btn primary', type: 'button', text: already ? 'Already recorded' : 'SIP done' });
  const saveBtn = el('button', { class: 'btn primary', type: 'button', text: 'Save', hidden: 'hidden' });
  const closeBtn = el('button', { class: 'btn ghost', type: 'button', text: 'Close', onclick: closeModal });

  if (already) doneBtn.disabled = true;
  doneBtn.addEventListener('click', () => {
    form.hidden = false; doneBtn.hidden = true; saveBtn.hidden = false;
    closeBtn.textContent = 'Cancel';
    navInp.focus();
  });
  saveBtn.addEventListener('click', async () => {
    const u = num(unitsInp.value), n = num(navInp.value);
    if (!(n > 0)) { toast('Enter the NAV'); navInp.focus(); return; }
    if (!(u > 0)) { toast('Enter the units purchased'); unitsInp.focus(); return; }
    saveBtn.disabled = true;
    try {
      // Read the fund fresh: the copy the card holds may be a few minutes old, and this must add to
      // whatever is stored now rather than overwrite it.
      const live = (await DB.get('funds', fund.id)) || fund;
      const contributions = (live.contributions || []).concat([
        { date: reminder.date, amount: reminder.amount, units: Math.round(u * 1e6) / 1e6, nav: n, type: 'buy' },
      ]);
      // The NAV just paid is the newest price known, unless the fund already carries one that is newer.
      const newer = !live.navAsOf || reminder.date >= live.navAsOf;
      await DB.put('funds', {
        ...live,
        contributions,
        latestNav: newer ? n : live.latestNav,
        navAsOf: newer ? reminder.date : live.navAsOf,
        updatedAt: new Date().toISOString(),
      });
      closeModal();
      toast('SIP recorded \u00b7 ' + fmtIntCur(reminder.amount) + ' in ' + (fund.name || 'the fund'));
      renderHome();
    } catch (e) {
      saveBtn.disabled = false;
      toast('Could not save: ' + (e.message || e));
    }
  });

  openModal(el('div', { class: 'sheet sip-sheet' }, [
    el('h2', {}, [el('span', { class: 'sip-ico', text: '\u{1F4C8}' }), document.createTextNode(fund.name || 'Mutual fund')]),
    details,
    already ? el('p', { class: 'hint', text: 'A purchase on ' + _shortDayMon(reminder.date) + ' is already recorded for this fund.' }) : null,
    form,
    el('div', { class: 'btn-row' }, [doneBtn, saveBtn, closeBtn]),
  ].filter(Boolean)));
}

// Horizontally-scrolling strip of money ARRIVING within the next week, shown on
// Home above the section cards. Two sources, one rail:
//   FD   - the deposit matures (principal + interest lands as one lump)
//   BOND - the next scheduled payout (a coupon, a principal installment, or the
//          maturity lump for a bond that pays only at the end)
//
// Purely a nudge: incoming money usually needs a decision (renew, reinvest, or
// spend), and that decision is easy to miss when the FD ladder and the Bonds page
// each live three taps away.
//
// Cards deliberately carry NO instrument name - just how long, how much, and an
// FD/BOND badge. The strip answers "what's landing and when", and a tap goes to
// that instrument's LIST page (not the individual record's edit form) because the
// next thing you actually want is the whole ladder in context.
//
// Returns null when nothing is due, so Home appends nothing at all rather than an
// empty heading.
//
// Deliberately INCLUDES Emergency-Fund-linked records. Linking a record moves it
// out of a page's TOTALS, never out of its listings (it keeps its EF badge there)
// - and "cash arrives Thursday" is an action reminder, not a total, so it matters
// no matter which surface counts the money. The EF badge rides along so that money
// isn't mistaken for free cash.
export async function _homeUpcomingStrip() {
  // Coming Up is a Pro Plan feature. The reminders themselves (FD and bond dates, dividends, SIPs) still
  // live on their own screens for everybody; this is the strip that gathers them on Home.
  if (!isPaidPlan()) return null;
  const now = Date.now();
  const items = [];

  // ---- FDs: the maturity lump ----
  try {
    const fds = (await DB.byIndex('fds', 'owner', 'me')) || [];
    if (fds.length) {
      const mod = await import('./fd.js');
      // resolveChain, not computeFd: an FD funded by rolled-in matured parents has
      // a bigger effective deposit, so its payout is only right via the chain.
      const byId = new Map(fds.map((x) => [x.id, x]));
      const cache = new Map();
      fds.forEach((f) => {
        const c = mod.resolveChain(f, byId, now, cache);
        // Active only - a matured FD has already paid out, so it isn't "upcoming".
        // An active FD is never superseded by a child, so no supersede check needed.
        if (c.effectiveStatus !== 'active') return;
        if (c.daysToMaturity == null || c.daysToMaturity > UPCOMING_DAYS) return;
        items.push({
          kind: 'FD', days: c.daysToMaturity, amount: c.maturityValue,
          date: c.maturity, ef: !!f.emergencyFund, go: () => setAppMode('fd'),
        });
      });
    }
  } catch (_) { /* one source failing must not take out the other */ }

  // ---- Bonds: the next scheduled payout ----
  try {
    const bonds = (await DB.byIndex('bonds', 'owner', 'me')) || [];
    if (bonds.length) {
      const mod = await import('./bonds.js');
      bonds.forEach((b2) => {
        const c = mod.computeBond(b2, now);
        if (c.effectiveStatus !== 'active' || c.isSold) return;
        // A bond with periodic interest or amortizing principal has a schedule, so
        // `nextDue` is the next dated event on it (its final row is the maturity
        // lump, so this covers maturity too). A plain at-maturity bond has NO
        // schedule and therefore no nextDue - for those the one payout event is
        // the maturity itself.
        let date = null, amount = 0;
        if (c.nextDue) {
          date = c.nextDue.date;
          amount = (Number(c.nextDue.interest) || 0) + (Number(c.nextDue.principal) || 0);
        } else if (c.maturity) {
          date = c.maturity;
          amount = c.maturityValue;
        }
        if (!date || !(amount > 0)) return;
        const days = Math.ceil((Date.parse(date) - now) / 86400000);
        if (!(days >= 0) || days > UPCOMING_DAYS) return;
        items.push({
          kind: 'BOND', days, amount, date,
          ef: !!b2.emergencyFund, go: () => openBond(),
        });
      });
    }
  } catch (_) {}

  // ---- Mutual fund SIPs: only funds that have a SIP amount AND a SIP date, two days ahead ----
  try {
    const funds = (await DB.byIndex('funds', 'owner', 'me')) || [];
    if (funds.length) {
      const mod = await import('./mf.js');
      funds.forEach((f) => {
        const r = mod.sipReminder(f, new Date(now));
        // Already recorded for that date ("SIP done" from here, or the fund form): nothing left to remind.
        if (r && (f.contributions || []).some((x) => x.type !== 'sell' && x.date === r.date)) return;
        if (r) items.push({ kind: 'SIP', days: r.days, amount: r.amount, date: r.date, name: r.name, fund: f, go: () => openSipDoneSheet(f, r) });
      });
    }
  } catch (_) {}

  // ---- Dividends: stocks that historically pay THIS calendar month ----
  // A stock qualifies when it pays in this month and nothing has been recorded
  // against THIS MONTH of the current year yet - see dividend.js
  // isMonthPending. Logging that month's figure drops it from the reminder,
  // since there's nothing left to check for.
  //
  // India and US get SEPARATE cards. They're different currencies and different
  // brokers, so they're two different things to go and check - one merged card
  // read as a single errand and buried which market each name belonged to.
  try {
    const mod = await import('./dividend.js');
    const recs = await _eligibleDividendRecords(mod, { write: false });
    if (recs.length) {
      const nowDate = new Date(now);
      const curMonAbbr = mod.MONTHS[nowDate.getMonth()];
      const curYear = nowDate.getFullYear();
      const monthName = nowDate.toLocaleString('en-US', { month: 'long' });
      const due = recs.filter((d) => mod.isMonthPending(d, curYear, curMonAbbr));
      // Market named in words, not a 🇺🇸/🇮🇳 flag: regional-indicator pairs don't
      // render as flags on Windows, where they fall back to the bare letters —
      // "us Dividend of September" reads as the pronoun.
      // US first so it sorts ahead of India on the equal-days tiebreak below.
      [{ market: 'us', label: 'US' }, { market: 'in', label: 'India' }].forEach(({ market, label }, ix) => {
        const names = due.filter((d) => d.market === market).map((d) => d.name).filter(Boolean);
        if (!names.length) return;
        // No real "days left" for a whole-month reminder - sorted to the end,
        // after every dated FD/bond item, rather than competing with them.
        items.push({
          kind: 'DIV', days: UPCOMING_DAYS + 1000 + ix, names,
          monthLabel: label + ' Dividend · ' + monthName, go: () => openDividend(),
        });
      });
    }
  } catch (_) {}

  // ---- Medicine Cabinet: one card for packs that have expired (dispose), one for those expiring within 30 days ----
  try {
    const meds = await DB.all('medicines').catch(() => []);
    if (meds.length) {
      const mod = await import('./medicine.js');
      const list = mod.comingUp(meds, todayISO());
      const expired = list.filter((m) => m._status.state === 'expired'), soon = list.filter((m) => m._status.state === 'soon');
      const goMeds = () => import('./health.js').then((h) => { h.enterMedicinesNext(); setAppMode('health'); });
      if (expired.length) items.push({ kind: 'MED', expired: true, days: -1, names: expired.map((m) => m.name), go: goMeds });
      if (soon.length) items.push({ kind: 'MED', days: soon[0]._status.days, names: soon.map((m) => m.name), date: mod.expiryEnd(soon[0].expiry), go: goMeds });
    }
  } catch (_) {}

  // Reminders only for the features the user chose.
  const _kindModule = { FD: 'fd', BOND: 'bond', DIV: 'div', SIP: 'mf', MED: 'health' };
  for (let i = items.length - 1; i >= 0; i--) {
    if (!modOn(_modsCache, _kindModule[items[i].kind])) items.splice(i, 1);
  }
  if (!items.length) return null;
  items.sort((a, b2) => a.days - b2.days);

  // One event at a time, rotating: each slides in, holds, slides out, and the next takes its place -
  // a glanceable ticker instead of a rail of cards to swipe. Tapping the event opens the same sheet the
  // card used to (SIP done, the FD ladder, bonds, dividends). Touch or hover pauses it; the dots jump.
  const ICON = { FD: '\u{1F3E6}', BOND: '\u{1F4DC}', SIP: '\u{1F4C8}', DIV: '\u{1F4B0}', MED: '\u{1F48A}' };
  const whenTxt = (it) => {
    if (it.kind === 'DIV') return 'This month';
    if (it.kind === 'MED' && it.expired) return 'Expired';
    const d = it.days;
    return d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days';
  };
  const titleTxt = (it) => it.kind === 'DIV' ? it.monthLabel
    : it.kind === 'MED' ? (it.expired ? 'Dispose ' : 'Buy again: ') + (it.names.length === 1 ? 'medicine' : it.names.length + ' medicines')
    : it.kind === 'SIP' ? 'SIP · ' + (it.name || 'Mutual fund')
    : it.kind === 'FD' ? 'FD matures' : 'Bond payout';
  const subTxt = (it) => it.kind === 'DIV' ? it.names.join(', ')
    : it.kind === 'MED' ? it.names.join(', ') + (it.date ? ' · expires ' + _shortDayMon(it.date) : '')
    : fmtIntCur(it.amount) + (it.date ? ' · ' + _shortDayMon(it.date) : '');
  const slide = (it) => el('button', { class: 'upc-slide' + (it.kind !== 'DIV' && it.days <= 2 ? ' is-urgent' : ''), type: 'button', onclick: it.go }, [
    el('span', { class: 'upc-ico upc-' + it.kind.toLowerCase(), text: ICON[it.kind] || '⏰' }),
    el('span', { class: 'upc-body' }, [
      el('span', { class: 'upc-title', text: titleTxt(it) }),
      el('span', { class: 'upc-sub', text: subTxt(it) }),
    ]),
    el('span', { class: 'upc-side' }, [
      el('span', { class: 'upc-when', text: whenTxt(it) }),
      it.ef ? el('span', { class: 'badge ef-badge mf-beat', text: 'EF' }) : null,
    ].filter(Boolean)),
  ]);

  const stage = el('div', { class: 'upc-stage' });
  const dots = el('div', { class: 'upc-dots' }, items.map((_, i) => el('span', { class: 'upc-dot' + (i ? '' : ' on') })));
  const strip = el('div', { class: 'upc' }, [
    el('div', { class: 'upc-head' }, [
      el('span', { class: 'upc-label', text: '⏰ Coming up' }),
      items.length > 1 ? dots : el('span', { class: 'upc-count', text: '1 item' }),
    ]),
    stage,
  ]);
  let ix = 0, timer = null, paused = false, outTimer = null;
  const show = (i, animate) => {
    ix = (i + items.length) % items.length;
    // A second show() landing before the previous transition's 380ms is up (a dot tapped mid-slide,
    // or the interval firing right on top of it) used to leave that fading-out slide behind instead of
    // removing it - stage then held two fully-opaque, un-transformed slides stacked on each other,
    // which is the "merged text" bug. Cancel any pending removal and force down to at most one
    // leftover slide before starting a fresh transition, so there is never more than two in the stage.
    if (outTimer) { clearTimeout(outTimer); outTimer = null; }
    while (stage.children.length > 1) stage.removeChild(stage.lastElementChild);
    const next = slide(items[ix]);
    const prev = stage.firstElementChild;
    if (prev && animate) {
      prev.classList.add('is-out');
      next.classList.add('is-in');
      stage.appendChild(next);
      outTimer = setTimeout(() => { prev.remove(); next.classList.remove('is-in'); outTimer = null; }, 380);
    } else { stage.innerHTML = ''; stage.appendChild(next); }
    dots.querySelectorAll('.upc-dot').forEach((d, j) => d.classList.toggle('on', j === ix));
  };
  show(0, false);
  if (items.length > 1) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      if (!strip.isConnected) { clearInterval(timer); return; }   // Home was redrawn: this strip is gone
      if (!paused) show(ix + 1, !reduce);
    };
    timer = setInterval(tick, 3200);
    const hold = () => { paused = true; };
    const letGo = () => { paused = false; };
    stage.addEventListener('pointerenter', hold);
    stage.addEventListener('pointerleave', letGo);
    stage.addEventListener('touchstart', hold, { passive: true });
    stage.addEventListener('touchend', () => setTimeout(letGo, 1500), { passive: true });
    dots.querySelectorAll('.upc-dot').forEach((d, j) => d.addEventListener('click', () => show(j, !reduce)));
  }
  return strip;
}

// 'YYYY-MM-DD' -> '3 Sep'. The year is noise for something landing inside a
// week, and dropping it keeps the card narrow.
function _shortDayMon(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? +m[3] + ' ' + _FD_MONS[+m[2] - 1] : '';
}

// ---------- Home FAB rings (Pro Plan) ----------
// A strip of fine LEDs set just inside the rim of each add-spend FAB on Home. The lit ticks are the
// share of this month's limit already spent: the household budget for the Tracker FAB, the Card + UPI
// limit for the personal one; a full ring (red) means the limit is used up. The head LED breathes, and
// each new entry makes it blink while the extra ticks light up one by one. Ported from the original
// MyNote. Pro Plan only; no limit set means no ring. Reads data only; the last reading sits in
// localStorage just to animate the difference (a convenience, safe to lose).
const FAB_RING_DASHES = 60;
const FAB_RING_R = 20.5;
const _fabRingPrev = {};
function _fabRingLoad(id) {
  if (_fabRingPrev[id]) return _fabRingPrev[id];
  try { const v = JSON.parse(localStorage.getItem('fabRing:' + id) || 'null'); if (v) return v; } catch (_) {}
  return null;
}
function _fabRingStore(id, v) {
  _fabRingPrev[id] = v;
  try { localStorage.setItem('fabRing:' + id, JSON.stringify(v)); } catch (_) {}
}
function _fabRingDashes(n) {
  // Fine hairline ticks with even gaps: an instrument-like scale rather than chunky blocks.
  const unit = 100 / FAB_RING_DASHES, dash = unit * 0.42, gap = unit - dash;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(dash.toFixed(3), gap.toFixed(3));
  parts.push('0', '200');
  return parts.join(' ');
}
// Lights n ticks and parks the bright head LED on the last lit one (hidden when nothing is lit).
function _fabRingDraw(svg, n) {
  svg.querySelector('.fab-ring-lit').setAttribute('stroke-dasharray', _fabRingDashes(n));
  const head = svg.querySelector('.fab-ring-head');
  if (!n) { head.setAttribute('opacity', '0'); return; }
  const a = ((n - 0.71) / FAB_RING_DASHES) * 2 * Math.PI - Math.PI / 2;
  head.setAttribute('cx', (24 + FAB_RING_R * Math.cos(a)).toFixed(2));
  head.setAttribute('cy', (24 + FAB_RING_R * Math.sin(a)).toFixed(2));
  head.setAttribute('opacity', '1');
}
function _clearFabRing(btn) {
  if (!btn) return;
  const svg = btn.querySelector('svg.fab-ring');
  if (svg) svg.remove();
  clearInterval(btn._ringTimer);
  btn.classList.remove('has-ring', 'is-full', 'ring-blink');
}
function _setFabRing(btn, spent, limit) {
  if (!btn) return;
  if (!(limit > 0)) { _clearFabRing(btn); return; }
  const NS = 'http://www.w3.org/2000/svg';
  let svg = btn.querySelector('svg.fab-ring');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'fab-ring');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('aria-hidden', 'true');
    ['fab-ring-track', 'fab-ring-lit'].forEach((cls) => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', '24'); c.setAttribute('cy', '24'); c.setAttribute('r', String(FAB_RING_R));
      c.setAttribute('pathLength', '100');
      c.setAttribute('transform', 'rotate(-90 24 24)');
      svg.appendChild(c);
    });
    const head = document.createElementNS(NS, 'circle');
    head.setAttribute('class', 'fab-ring-head');
    head.setAttribute('r', '1.9');
    svg.appendChild(head);
    svg.querySelector('.fab-ring-track').setAttribute('stroke-dasharray', _fabRingDashes(FAB_RING_DASHES));
    btn.appendChild(svg);
  }
  btn.classList.add('has-ring');
  const frac = Math.max(0, spent) / limit;
  const lit = Math.min(FAB_RING_DASHES, Math.round(Math.min(1, frac) * FAB_RING_DASHES));
  btn.classList.toggle('is-full', frac >= 1);
  const ym = todayISO().slice(0, 7);
  const prev = _fabRingLoad(btn.id);
  clearInterval(btn._ringTimer);
  if (prev && spent > prev.spent + 0.005 && prev.ym === ym) {
    // A new entry: the head LED blinks while the extra ticks light up one at a time.
    let n = Math.min(prev.lit, lit);
    _fabRingDraw(svg, n);
    btn.classList.remove('ring-blink'); void btn.offsetWidth; btn.classList.add('ring-blink');
    clearTimeout(btn._blinkTimer);
    btn._blinkTimer = setTimeout(() => btn.classList.remove('ring-blink'), 2400);
    btn._ringTimer = setInterval(() => {
      if (n >= lit) { clearInterval(btn._ringTimer); return; }
      n++; _fabRingDraw(svg, n);
    }, 60);
  } else {
    _fabRingDraw(svg, lit);
  }
  _fabRingStore(btn.id, { ym, spent, lit });
}
// Per-day figure on the House Expense and Personal Finance cards: drawn with Home and again on every saved
// spend, so it moves as soon as money is noted (before, only the FAB rings were refreshed).
export async function refreshHomePerDay(root) {
  const scope = root || document;
  const expenseCard = scope.querySelector('[data-home-card="expense"]');
  const personalCard = scope.querySelector('[data-home-card="personal"]');
  if (!expenseCard && !personalCard) return;
  try {
    const thisYm = todayISO().slice(0, 7);
    const daysLeft = _spendableDaysLeft(thisYm);
    if (expenseCard) {
      const [allocs, efLoans, kittyRows] = await Promise.all([
        DB.all('allocations').catch(() => []),
        DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
        DB.byIndex('spends', 'ym', thisYm).catch(() => []),
      ]);
      const kitty = _kittyFor(thisYm, allocs, efLoans);
      if (kitty > 0) {
        const spent = round2((kittyRows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0));
        _perDayBadge(expenseCard.querySelector('.home-card-badge'), round2(kitty - spent), daysLeft);
      }
    }
    if (personalCard) {
      const pf = await pfLoad();
      const t = pfTotals(thisYm, pf.byYm, pf.allocs, pf.upiLimit);
      if (t.limit > 0) _perDayBadge(personalCard.querySelector('.home-card-badge'), t.left, daysLeft);
    }
  } catch (_) { /* Home stands without it */ }
}
export async function refreshHomeFabRings() {
  if (state.appMode === 'home') refreshHomePerDay();
  const kittyBtn = $('#spendAddBtn'), pfBtn = $('#pfAddBtn');
  if (!isPaidPlan()) { _clearFabRing(kittyBtn); _clearFabRing(pfBtn); return; }
  if (state.appMode !== 'home') return;
  try {
    const ym = todayISO().slice(0, 7);
    const [allocs, efLoans, kittyRows] = await Promise.all([
      DB.all('allocations').catch(() => []),
      DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
      DB.byIndex('spends', 'ym', ym).catch(() => []),
    ]);
    const kitty = _kittyFor(ym, allocs, efLoans);
    _setFabRing(kittyBtn, round2((kittyRows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0)), kitty);
    const pf = await pfLoad();
    const t = pfTotals(ym, pf.byYm, pf.allocs, pf.upiLimit);
    _setFabRing(pfBtn, t.spent, t.limit);
  } catch (_) { /* the FABs work without their rings */ }
}
// The household spend form saves through renderHomeExpense (expense-ui.js), which signals Home here.
if (typeof window !== 'undefined') window.addEventListener('mynote-spend-saved', () => { refreshHomeFabRings(); });
