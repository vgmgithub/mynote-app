import { sortCardsByCycle } from './credit.js';
import { DB } from './db.js';
import { ENV, IS_PRODUCTION } from './config.js';
import { todayISO, num, thisYm, fmtCur, fmtIntRate, pctClass, fmtPct } from './core.js';
import { ui } from './state.js';
import { isFixedCategory, stepProgress } from './get-started.js';
import { recentCategories, usualAmounts, lastChoice, leftAfter, dayShift } from './spend-quick.js';
import { quickCategories, amountChips, dateChips, bigAmount, leftLine, leftWords, afterWords, markMissing, addedPill, stepFlow, groupHue, budgetCard } from './spend-kit.js';
import { openLoanEntries, openAllocFormForThisYear } from './expense-ui.js';
import { _mfValueCard, openMF } from './mf-ui.js';
import { openMetal } from './metals-ui.js';
import { openBond } from './bonds-ui.js';
import { openEmergency } from './ef.js';
import { _eligibleDividendRecords, openDividend } from './divs-ui.js';
import { getUserName, greetingFor, openNameEditor, el, catList, REFUND_CAT, field, PF_METHODS, toast, round2, syncOwedRow, isOwedRow, closeModal, fmtSheetCur, appConfirm, dropOwedRow, openModal, formSection, CAT_KINDS, saveCategoryList, b, SPEND_METHODS, state, $, renderTagAnalysis, _pfUpiLimit, PF_START_YM, isRefund, _pfCardLimit, pfRenderStale, _mountMonthStrip, _attachMonthSwipe, _spendDayLabel, _daysInYm, _SPEND_MONS, _spendableDaysLeft, perDayAllowance, perDayLabel, fmtSigned, _catMaps, _pfGroupClass, _spendMonthLabel, _reviewAnalysis, _pfGroupOf, _rvwScopeLine, rvwBudgetBadge, rvwBudgetRow, rvwKeepList, REVIEW_MIN_HISTORY, _reviewCycle, _reviewForecast, _reviewSavings, _reviewSmallTickets, _smallTicketUsual, rvwSection, _reviewCurve, _rvwCurveChart, _ordinalSuffix, explainRow, openInfoSheet, _rvwMonthBars, _catMonthHistory, _rvwCreepingSection, _reviewCreeping, _rvwMethodsSection, _reviewMethods, _rvwFitSection, _reviewKittyFit, renderHomeExpense, updateFdNavActive, refresh, moreOptions, modOn, _modsCache, isSgb, metalPortfolio, _gramsShort, openBackupSheet, setAppMode, getEnabledModules, APP_VERSION, _homeCard, _walletIcon, _homeLiveRatesStrip, _kittyFor, _perDayBadge, debounce, APP_MODULES, moduleIcon, _renewalBanner, liveCountdown, planIcon, isBetaPlan, isPaidPlan, includedStockProfiles } from './app.js';
import { sameMoment } from './pay-core.js';
import { homeBetaCard } from './beta-ui.js';
import { _homeUpcomingStrip, refreshHomeFabRings } from './home-ui.js';
import { renderPfCardCheck, pfCardCheckOpen, PF_TABS, cardCheckIcon } from './personal-review.js';
import { openCatManager, catAddBtn, knownTagsFor, normaliseTag, TAG_MAX, tagField, tagRow, spendEntryFilter, spendFilterNote } from './personal-tags.js';
export { openCatManager, catAddBtn, TAG_MAX, normaliseTag, tagsOf, knownTags, knownTagsFor, tagField, tagRow, spendEntryFilter, spendFilterNote } from './personal-tags.js';
export { renderPfReview, renderPfCardCheck, cardCheckIcon } from './personal-review.js';
export { renderFD, openFdForm, homeInvestedBreakdown, openInvestedBreakdown, UPCOMING_DAYS } from './fd-ui.js';
export { renewalMessage, mountRenewalCard, renderHome, refreshHomePerDay, refreshHomeFabRings } from './home-ui.js';

// ---------- Logging a personal spend ----------
//
// Same shape as the household spend form, with two differences that matter:
// Card and UPI only, and NOTHING is written to the credit card. The household
// version credits a card spend back as a reimbursement, because the house owes
// that money to the person who swiped. A personal spend is the swiper's own
// bill - crediting it back would tell them they owe less than they do.
//
// The card is still recorded, and the Card check tab reads it: a statement is
// household plus personal, so which card took a personal spend is exactly what
// makes that bill add up.
// opts (all optional), the same as the household form's (openSpendForm in expense-ui.js):
//   carry  values to start from: what was typed before "+ category", or the date and payment kept by "Save & add"
//   added  how many "Save & add" has saved so far · still  reopened in place, so the sheet does not rise in again
export async function openPfSpendForm(existing, defaultDate, opts = {}) {
  const editing = !!(existing && existing.id != null);
  const carry = opts.carry || {};
  const has = (k) => carry[k] !== undefined;
  const cards = sortCardsByCycle((await DB.all('creditCards').catch(() => [])) || []);
  // Tags rather than a note, suggested from every personal spend on record. The same rows say what is used most.
  const allPfRows = (await DB.all('personalSpends').catch(() => [])) || [];
  const today = todayISO();
  const allCats = catList('pf').reduce((a, g) => a.concat(g.items || []), []);
  // A new entry starts paid the way the last one was (and on the same card, if it still exists).
  const last = editing ? null : lastChoice(allPfRows, { methods: PF_METHODS, cardIds: cards.map((c) => c.id) });

  let chosenCat = has('cat') ? (allCats.indexOf(carry.cat) >= 0 ? carry.cat : null) : (editing ? existing.category : null);
  let chosenMethod = has('method') ? carry.method : editing ? (existing.method === 'UPI' ? 'UPI' : 'Card') : ((last && last.method) || 'Card');
  let chosenCardId = has('cardId') ? carry.cardId : editing ? (existing.cardId != null ? existing.cardId : null) : (last ? last.cardId : null);
  if (chosenMethod !== 'Card') chosenCardId = null;

  // Always typed as a positive figure. The sign is decided by the category on
  // save, so nobody has to remember to type a minus - and an edit of a refund
  // shows the amount as it was entered rather than as it is stored.
  const amount = el('input', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: '0',
    value: has('amount') ? carry.amount : editing ? Math.abs(Number(existing.amount) || 0) : '' });
  const dateInp = el('input', { type: 'date', value: has('date') ? carry.date : editing ? (existing.date || today) : (defaultDate || today) });
  const tagBox = tagField(has('tags') ? carry.tags : editing ? existing.tags : [], knownTagsFor(allPfRows, chosenCat), null);

  const catBtns = [];
  // Reopening the form is how an edit lands: the picker is built from the list
  // as it stands, so it has to be rebuilt, and rebuilding just this grid would
  // leave the rest of the sheet holding stale state anyway. What was typed rides along.
  const draft = () => ({ cat: chosenCat, amount: amount.value, date: dateInp.value, method: chosenMethod, cardId: chosenCardId, tags: tagBox.peek(), forOthers: chosenForOthers, owedBy: owedByInp.value });
  const reopen = () => openPfSpendForm(existing, defaultDate, Object.assign({}, opts, { carry: draft(), still: true }));
  // One place a category gets chosen, from the Recent row or the full list alike.
  const pickCat = (name) => {
    chosenCat = name;
    catBtns.forEach((x) => x.classList.toggle('active', x.textContent === name));
    quick.mark(name);
    syncRefund();
    syncAmounts();
    syncLeft();
    tagBox.reorder(knownTagsFor(allPfRows, chosenCat));
    flow.open('amount');
    amount.focus();
  };
  const catGrid = el('div', {}, catList('pf').map((g) => el('div', { class: 'spend-cat-group', style: '--h:' + groupHue(g.group) }, [
    el('div', { class: 'spend-cat-group-label' }, [
      el('span', { text: g.group }),
      catAddBtn('Add a sub-category under ' + g.group, () => openCatManager('pf', g.group, reopen)),
    ]),
    el('div', { class: 'spend-cat-grid' }, g.items.map((name) => {
      const btn = el('button', {
        class: 'spend-cat-btn' + (name === chosenCat ? ' active' : '')
          + (name === REFUND_CAT ? ' is-refund' : ''),
        type: 'button', text: name,
      });
      btn.addEventListener('click', () => pickCat(name));
      catBtns.push(btn);
      return btn;
    })),
  ])));
  // The categories used most lately come first; with enough of them the full list folds away (open when what is
  // being edited is not one of them).
  const recents = recentCategories(allPfRows, { valid: allCats, exclude: [REFUND_CAT], today });
  const quick = quickCategories({
    recents, grid: catGrid, current: chosenCat, onPick: pickCat,
    hueOf: (name) => { const g = catList('pf').find((x) => (x.items || []).indexOf(name) >= 0); return groupHue(g ? g.group : name); },
    fold: recents.length >= 3 && (!chosenCat || recents.indexOf(chosenCat) >= 0),
  });

  // The form says which way the money is going, rather than leaving the user to
  // work it out from the category they picked.
  const amountField = field('Amount (₹)', bigAmount(amount, () => save()));
  const amts = amountChips((a) => { amount.value = String(a); amount.dispatchEvent(new Event('input')); amount.blur(); flow.next('amount'); });
  const syncAmounts = () => amts.show(chosenCat && chosenCat !== REFUND_CAT ? usualAmounts(allPfRows, chosenCat, { today }) : []);
  const amountLabel = amountField.querySelector('label span') || amountField.querySelector('label');
  const refundNote = el('p', { class: 'hint pf-refund-note hidden',
    text: 'Money coming back. Enter it as a positive figure — it comes off the month\u2019s '
      + 'total, off both limits, and off the card it was credited to.' });
  const syncRefund = () => {
    const on = chosenCat === REFUND_CAT;
    if (amountLabel) amountLabel.textContent = on ? 'Refunded (₹)' : 'Amount (₹)';
    amountField.classList.toggle('is-refund', on);
    refundNote.classList.toggle('hidden', !on);
    // "For others" is about a spend somebody will pay back. A refund is money
    // already back, so the two cannot both be true and the switch goes away
    // rather than sitting there meaning nothing.
    othersField.classList.toggle('hidden', on);
    if (on) { chosenForOthers = false; othersChk.checked = false; }
  };

  const cardBtns = [];
  const cardGrid = el('div', { class: 'spend-card-grid' }, cards.map((c) => {
    const btn = el('button', { class: 'spend-card-btn' + (c.id === chosenCardId ? ' active' : ''), type: 'button' }, [
      el('span', { class: 'spend-card-radio' }),
      el('span', { class: 'spend-card-name', text: c.name || 'Card' }),
    ]);
    btn.addEventListener('click', () => {
      chosenCardId = chosenCardId === c.id ? null : c.id;   // tap again to unset
      cardBtns.forEach((x) => x.classList.toggle('active', x === btn && chosenCardId === c.id));
      if (chosenCardId != null) flow.next('pay');
    });
    cardBtns.push(btn);
    return btn;
  }));
  const cardField = field('Which card', cards.length
    ? el('div', {}, [cardGrid, el('p', { class: 'hint', style: 'margin:6px 0 0',
        text: 'Recorded against this card so the Card check tab can tell you how much of its bill is yours rather than the house\u2019s. The card\u2019s own totals are left alone.' })])
    : el('p', { class: 'hint', style: 'margin:0', text: 'No credit cards yet — add one on the Expense \u2192 Credit Card tab.' }));
  cardField.classList.toggle('hidden', chosenMethod !== 'Card');

  // Same flag the entries list toggles, settable while logging rather than
  // only afterwards.
  let chosenForOthers = has('forOthers') ? !!carry.forOthers : editing ? isForOthers(existing) : false;
  const othersChk = el('input', { type: 'checkbox' });
  othersChk.checked = chosenForOthers;
  // Who will pay it back, in the person's own words (appa, a friend...). Asked only once For others is on.
  const owedByInp = el('input', { type: 'text', class: 'owed-by', maxlength: '30', placeholder: 'Who will pay this back? e.g. appa', autocomplete: 'off',
    value: has('owedBy') ? carry.owedBy : editing ? (existing.owedBy || '') : '' });
  const owedByWrap = el('div', { class: 'owed-by-wrap' + (chosenForOthers ? '' : ' hidden') }, [owedByInp]);
  othersChk.addEventListener('change', () => { chosenForOthers = othersChk.checked; owedByWrap.classList.toggle('hidden', !chosenForOthers); syncLeft(); });
  // What "for others" means sits behind an i beside the label, not as a paragraph under the switch.
  const othersField = field('For others', el('div', {}, [
    el('label', { class: 'switch' }, [othersChk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]),
    owedByWrap,
  ]));
  const othersLabel = othersField.querySelector('label');
  if (othersLabel) {
    othersLabel.appendChild(el('button', { class: 'help-dot', type: 'button', 'aria-label': 'What is For others?', text: 'i',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openInfoSheet('For others', 'Money spent for somebody who will pay it back. Still listed and still on the card\u2019s bill, but kept out of the two limits and out of Review.'); } }));
  }

  const methodBtns = [];
  const methodRow = el('div', { class: 'seg spend-method' }, PF_METHODS.map((m) => {
    const btn = el('button', { type: 'button', class: m === chosenMethod ? 'active' : '', text: m });
    btn.addEventListener('click', () => {
      chosenMethod = m;
      methodBtns.forEach((x) => x.classList.toggle('active', x === btn));
      cardField.classList.toggle('hidden', m !== 'Card');
      // Switching to UPI drops the card, so a UPI spend cannot sit against one
      // and quietly widen a statement check.
      if (m !== 'Card') { chosenCardId = null; cardBtns.forEach((x) => x.classList.remove('active')); }
      syncLeft();
      if (m !== 'Card') flow.next('pay');
    });
    methodBtns.push(btn);
    return btn;
  }));
  cardBtns.forEach((x) => x.addEventListener('click', () => syncLeft()));

  // What is left of the allowance this spend counts against (UPI's calendar month, or the card's statement month),
  // and what will be once it is in. New entries only: an edit would count itself twice.
  const left = leftLine();
  const pf = editing ? null : await pfLoad().catch(() => null);
  const cmod = pf ? await import('./credit.js') : null;
  const budgetHost = el('div');
  const syncBudget = () => {
    budgetHost.innerHTML = '';
    if (!pf || chosenForOthers) return;
    const card = chosenMethod === 'Card';
    const ym = pfCountedYm({ date: (dateInp.value || today).slice(0, 10), method: chosenMethod, cardId: card ? chosenCardId : null }, pf.cards, cmod);
    const t = pfTotals(ym, pf.byYm, pf.allocs, pf.upiLimit);
    // The overall personal limit: Card and UPI / Cash added together, against everything spent on both.
    const limit = t.limit;
    if (!(limit > 0)) return;
    const now = new Date();
    const days = ym === today.slice(0, 7) ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1 : 0;
    const who = 'Personal \u00b7 ' + cmod.monthLabel(ym);
    budgetHost.appendChild(budgetCard({ fmt: fmtSheetCur, budget: limit, left: t.left, daysLeft: days, label: who + ' left', overLabel: who + ' over' }));
  };
  const syncLeft = () => {
    syncBudget();
    if (!pf) return;
    if (chosenForOthers) { left.set('For others \u00b7 kept out of your limits'); return; }
    const d = (dateInp.value || today).slice(0, 10);
    const card = chosenMethod === 'Card';
    const ym = pfCountedYm({ date: d, method: chosenMethod, cardId: card ? chosenCardId : null }, pf.cards, cmod);
    const t = pfTotals(ym, pf.byYm, pf.allocs, pf.upiLimit);
    // Overall: the Card limit plus the UPI / Cash limit, against what has gone on both.
    if (!(t.limit > 0)) { left.set(''); return; }
    const now = t.left;
    const typed = round2(Math.abs(num(amount.value) || 0));
    const after = leftAfter(now, typed, chosenCat === REFUND_CAT);
    left.set('Personal limit (' + fmtSheetCur(t.cardLimit) + ' card + ' + fmtSheetCur(t.upiLimit) + ' UPI / Cash) \u00b7 ' + leftWords(fmtSheetCur, now) + ' for ' + cmod.monthLabel(ym)
      + (typed > 0 ? ' \u2192 ' + afterWords(fmtSheetCur, after) : ''), typed > 0 && after < 0);
  };
  amount.addEventListener('input', syncLeft);
  dateInp.addEventListener('change', syncLeft);

  let saving = false;
  // next: "Save & add" - saved exactly the same way, then the form opens again for the next spend, keeping the
  // date and how it was paid.
  const save = async (next = false) => {
    if (saving) return;
    if (!chosenCat) { toast('Pick a category'); flow.open('cat'); markMissing(flow.stepNode('cat')); return; }
    const typed = round2(Math.abs(num(amount.value) || 0));
    if (!(typed > 0)) { toast('Enter an amount'); flow.open('amount'); markMissing(amountField); amount.focus(); return; }
    // The sign goes on here, once, and every sum downstream is then simply
    // right - see REFUND_CAT.
    const refund = chosenCat === REFUND_CAT;
    const amt = refund ? -typed : typed;
    const nowIso = new Date().toISOString();
    // Filed under the month of the DATE CHOSEN, not today's - logging last
    // night's spend after midnight must not land it in the wrong month.
    const d = (dateInp.value || todayISO()).slice(0, 10);
    const rec = {
      ym: d.slice(0, 7), date: d, category: chosenCat, amount: amt,
      method: chosenMethod, cardId: chosenMethod === 'Card' ? chosenCardId : null,
      forOthers: refund ? false : chosenForOthers,
      owedBy: (!refund && chosenForOthers && owedByInp.value.trim()) ? owedByInp.value.trim().slice(0, 30) : null,
      // "appa paid": a tag named for who settles it, kept in step with the name (the previous one is dropped).
      tags: (() => {
        const auto = (n) => (n ? normaliseTag(n + ' paid') : '');
        const was = auto(editing ? existing.owedBy : '');
        const kept = (tagBox.get() || []).filter((t) => t !== was);
        const now = (!refund && chosenForOthers) ? auto(owedByInp.value.trim()) : '';
        return now && !kept.includes(now) ? [now].concat(kept).slice(0, TAG_MAX) : kept;
      })(),
      // Kept rather than dropped, same as the household form.
      note: editing && existing.note ? existing.note : null,
      createdAt: editing ? (existing.createdAt || nowIso) : nowIso, updatedAt: nowIso,
    };
    if (editing) rec.id = existing.id;
    // A second tap while this saves must not add it twice (Done on the keyboard and the button, say).
    saving = true;
    const savedId = await DB.put('personalSpends', rec).catch((err) => { saving = false; throw err; });
    // A UPI spend somebody owes you back gets a Virtual Bal row. The previous
    // state decides whether a missing row means "never had one" or "you took
    // it off" - see syncOwedRow.
    await syncOwedRow(rec, editing ? existing.id : savedId, editing && isOwedRow(existing));
    closeModal();
    // The strip moves to the month the entry is FILED under, so a back-dated
    // spend is visible instead of appearing to have done nothing. For a card
    // spend that month is the statement it lands on, not the calendar month it
    // happened in - 20 July on a card that closes on the 7th is August's.
    //
    // Using the calendar month here sent the strip to a month the entry was
    // NOT in; the strip then clamped to the newest month it did know, which is
    // how saving into a past month jumped to the current one.
    const cmod = await import('./credit.js');
    const filedYm = pfCountedYm(rec, cards, cmod);
    const jumped = filedYm !== ui._pfYm;
    toast((editing ? 'Updated ' : 'Added ') + fmtSheetCur(typed)
      + (refund ? ' back · off the month\u2019s total' : '')
      // Named only when the view is about to change under them, never for a
      // spend logged into the month already on screen.
      + (jumped ? ' · ' + cmod.monthLabel(filedYm) : ''));
    ui._pfYm = filedYm;
    renderPersonal();
    if (opts.onSaved) opts.onSaved();
    if (next) {
      openPfSpendForm(null, defaultDate, Object.assign({}, opts, {
        carry: { date: d, method: chosenMethod, cardId: rec.cardId }, added: (opts.added || 0) + 1, still: true,
      }));
    }
  };
  const del = async () => {
    if (!editing) return;
    if (!(await appConfirm('Delete this spend?'))) return;
    await dropOwedRow(existing);
    await DB.del('personalSpends', existing.id);
    closeModal();
    toast('Deleted');
    renderPersonal();
    if (opts.onSaved) opts.onSaved();
  };

  // Category -> amount -> date -> paid by -> tags, one step open at a time, like the household form.
  const yest = dayShift(today, -1);
  const cardName = () => { const c = cards.find((x) => x.id === chosenCardId); return c ? c.name || 'Card' : ''; };
  const flow = stepFlow([
    { key: 'cat', label: 'Category', body: el('div', {}, [
      el('div', { class: 'step-tools' }, [el('span', { text: 'New category' }), catAddBtn('Add a category', () => openCatManager('pf', null, reopen))]),
      quick.node,
    ]), summary: () => chosenCat || '' },
    { key: 'amount', label: 'Amount', body: el('div', {}, [amountField, amts.node, left.node, refundNote,
      el('button', { type: 'button', class: 'btn small step-next', text: 'Next \u203a', onclick: () => flow.next('amount') })]),
      summary: () => { const v = round2(Math.abs(num(amount.value) || 0)); return v > 0 ? (chosenCat === REFUND_CAT ? 'Refund ' : '') + fmtSheetCur(v) : ''; } },
    { key: 'date', label: 'Date', body: dateChips(dateInp, today),
      summary: () => { const v = dateInp.value; if (!v) return ''; return v === today ? 'Today' : v === yest ? 'Yesterday' : new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } },
    { key: 'pay', label: 'Paid by', body: el('div', {}, [methodRow, cardField]),
      summary: () => chosenMethod + (chosenMethod === 'Card' && cardName() ? ' \u00b7 ' + cardName() : '') },
    { key: 'tags', label: 'Tags', body: el('div', {}, [tagBox.node, othersField]), optional: true,
      summary: () => [(tagBox.peek() || []).join(', '), chosenForOthers ? 'for others' + (owedByInp.value.trim() ? ' · ' + owedByInp.value.trim() : '') : ''].filter(Boolean).join(' \u00b7 ') },
  ], chosenCat ? 'amount' : 'cat');
  dateInp.addEventListener('change', () => flow.next('date'));

  syncRefund();
  syncAmounts();
  syncLeft();

  const btns = [el('button', { class: 'btn primary', text: editing ? 'Save' : 'Add spend', onclick: () => save() })];
  if (editing) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  else btns.push(el('button', { class: 'btn quick-next', type: 'button', text: 'Save & add', title: 'Save this one and add another', onclick: () => save(true) }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));

  // The amount is no longer focused on open: the keyboard would cover the categories, which come first. Picking
  // one puts the cursor in the amount, the same as the household form.
  openModal(el('div', { class: 'sheet has-fixed-footer quick-form' + (opts.still ? ' no-rise' : '') }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { class: 'quick-title' }, [document.createTextNode(editing ? 'Edit Personal Spend' : 'Add Personal Spend'), addedPill(opts.added)].filter(Boolean)),
      budgetHost,
      flow.node,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}


// ---------- Personal Finance: the section renderer ----------
export async function renderPersonal() {
  // A spend logged from the Home FAB lands here; Home itself only needs its FAB rings brought up to date.
  if (state.appMode === 'home') { refreshHomeFabRings(); return; }
  if (state.appMode !== 'personal') return;
  const host = $('#pfView');
  host.innerHTML = '';
  updatePfNavActive();
  $('#pfAddBtn').classList.toggle('hidden', ui._pfTab !== 'spends');

  const token = ++ui._pfRenderToken;
  // Review moved to Analysis; a tab left on it opens Spends.
  if (!PF_TABS.some(([v]) => v === ui._pfTab)) { ui._pfTab = 'spends'; updatePfNavActive(); $('#pfAddBtn').classList.remove('hidden'); }
  if (ui._pfTab === 'limits') { await renderPfLimits(host, token); return; }
  if (ui._pfTab === 'cat') {
    const m = await import('./category-spend.js');
    if (pfRenderStale(token)) return;
    await m.renderCategorySpend(host, token, { kind: 'personal', stale: pfRenderStale, rerender: renderPersonal });
    return;
  }
  if (ui._pfTab === 'cards') {
    if (!pfCardCheckOpen()) {
      host.appendChild(el('div', { class: 'empty cc-locked' }, [
        el('div', { class: 'e-icon', text: '\u{1F512}' }),
        el('p', { text: 'Select Expenses + Personal Finance to compare your card statements with your logged spending.' }),
      ]));
      return;
    }
    await renderPfCardCheck(host, token);
    return;
  }
  if (ui._pfTab === 'tags') { await renderTagAnalysis(host, token, { source: 'personal' }); return; }
  await reviewMovedNote(host, renderPersonal);
  if (pfRenderStale(token)) return;
  await renderPfSpends(host, token);
}

// Once, for somebody whose five were already full when Review moved into Analysis (so it could not be switched on
// for them): says where Review went and how to get it, until dismissed or Analysis is chosen. Returns true if shown.
export async function reviewMovedNote(host, rerender) {
  const r = await DB.get('meta', 'reviewMovedNote').catch(() => null);
  if (!r || r.value !== 'show' || modOn(_modsCache, 'analysis')) return false;
  const dismiss = async () => { await DB.put('meta', { key: 'reviewMovedNote', value: 'dismissed' }).catch(() => {}); rerender(); };
  host.appendChild(el('div', { class: 'card review-moved' }, [
    el('b', { text: 'Review has moved to Analysis' }),
    el('p', { class: 'hint', text: 'Forecasts, "worth a look" and where you could save are in the new Analysis feature. Swap it in for one of your five in Menu → Settings · Choose features.' }),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost small', type: 'button', text: 'Got it', onclick: dismiss })]),
  ]));
  return true;
}

// Which month a personal spend is COUNTED in - see the note inside pfLoad for
// why card and UPI answer that differently.
//
// Out here rather than inside pfLoad because the SPEND FORM needs it too: after
// saving it moves the month strip to the month it just wrote into, and if it
// worked that out by a different rule than the one grouping the months, it
// would land on a month the new entry is not in. The strip then clamps to the
// newest month it does know, which is how saving into a past month ended up
// jumping to the current one.
export function pfCountedYm(r, cards, mod) {
  const d = String((r && r.date) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return String((r && r.ym) || '').slice(0, 7);
  if (r.method !== 'Card' || r.cardId == null) return d.slice(0, 7);
  const card = (cards || []).find((c) => c.id === r.cardId);
  return card ? mod.statementYmFor(d, card) : d.slice(0, 7);
}

// Everything the section needs, read once. Personal spend rows are a few
// hundred a year, so loading every month costs less than a read per month and
// the month-on-month comparisons need the history anyway.
// A spend made FOR SOMEBODY ELSE, who will pay it back. It is still money that
// left the account, so it stays in the list, in the category roll-up and on the
// card's bill - the bank billed it either way.
//
// What it is not is a call on the personal ALLOWANCE. The limits exist to
// answer "how much of my own spending is left this month", and money that comes
// back is not own spending. So the two limit strips, the Limits table and the
// whole Review tab read the list with these taken out.
export const isForOthers = (r) => !!(r && r.forOthers);
// A byYm-shaped map with them removed, for the surfaces that measure against a
// limit. Months with nothing left are dropped rather than left as empty arrays.
// The same month map with refunds (negative amounts) taken out - what Analysis reads, which is spending alone.
export function pfSpendsOnly(byYm) {
  const out = new Map();
  byYm.forEach((rows, k) => {
    const spent = rows.filter((r) => !isRefund(r));
    if (spent.length) out.set(k, spent);
  });
  return out;
}

export function pfOwnMap(byYm) {
  const out = new Map();
  byYm.forEach((rows, k) => {
    const own = rows.filter((r) => !isForOthers(r));
    if (own.length) out.set(k, own);
  });
  return out;
}

export async function pfLoad() {
  const mod = await import('./credit.js');
  const [rows, allocs, cards, upiLimit] = await Promise.all([
    DB.all('personalSpends').catch(() => []),
    DB.all('allocations').catch(() => []),
    DB.all('creditCards').then((r) => sortCardsByCycle(r || [])).catch(() => []),
    _pfUpiLimit(),
  ]);

  // Which month a spend is COUNTED in, which is not the same question as when
  // it happened - and differs by how it was paid, because the two allowances
  // run on different clocks:
  //
  //   UPI  - a calendar-month allowance, so it counts in the month of the
  //          spend. 1 Sep to 30 Sep is September.
  //   Card - the allowance is really a bill, so it counts on the statement
  //          that bill lands on: that card's own cycle. On a 21-20 card, the
  //          25th of August is September's money and the 22nd of September is
  //          October's. Two cards on different cycles therefore split the same
  //          calendar month differently, which is correct rather than untidy.
  //
  // A card spend with no card chosen, or on a card with no cycle recorded,
  // falls back to its calendar month: nothing is known about when that bill
  // closes, and guessing would be worse than saying so.
  const countedYm = (r) => pfCountedYm(r, cards, mod);

  const byYm = new Map();       // counted months - limits are measured on these
  const byYmCal = new Map();    // calendar months - see the note below
  (rows || []).forEach((r) => {
    const cal = String(r.ym || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(cal)) {
      if (!byYmCal.has(cal)) byYmCal.set(cal, []);
      byYmCal.get(cal).push(r);
    }
    const k = countedYm(r);
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    if (!byYm.has(k)) byYm.set(k, []);
    byYm.get(k).push(r);
  });
  return { rows: rows || [], byYm, byYmCal, allocs: allocs || [], cards: cards || [], upiLimit, countedYm };
}

// The months the timeline offers: from the month tracking started to this one,
// plus any month that actually holds entries.
//
// A month AHEAD of today is offered when it holds counted spends, which is not
// hypothetical: on a 21-20 card a swipe on the 25th counts on the bill closing
// next month, so the allowance it eats into is next month's. Filtering those
// out left today's own spend unreachable. Empty future months stay out - they
// appear the moment something lands in them, which is when they start to
// matter.
export function pfMonths(byYm, thisYm, mod) {
  const range = mod.monthRangeYm(PF_START_YM, thisYm).filter((k) => k <= thisYm);
  const out = [...new Set(range.concat([...byYm.keys()], [thisYm]))].sort();
  return out.length ? out : [thisYm];
}

// Card and UPI, each against its own allowance. Returned together because
// every tab here reads both: two limits that are only ever half-checked is how
// a month comes in "under" while the card is 3,000 over.
export function pfTotals(ym, byYm, allocs, upiLimit) {
  const rows = byYm.get(ym) || [];
  // `rows` is everything, for the list and the roll-up. The limit figures are
  // measured on own spending only.
  const own = rows.filter((r) => !isForOthers(r));
  const sum = (f) => round2(own.filter(f).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const othersTotal = round2(rows.filter(isForOthers).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const othersCount = rows.filter(isForOthers).length;
  // Refunds are negative, so they are already off both of these.
  const cardSpent = sum((r) => r.method === 'Card');
  const upiSpent = sum((r) => r.method === 'UPI');
  const refundTotal = round2(Math.abs(own.filter(isRefund).reduce((a, r) => a + (Number(r.amount) || 0), 0)));
  const refundCount = own.filter(isRefund).length;
  const cardLimit = _pfCardLimit(ym, allocs);
  const upi = round2(upiLimit || 0);
  return {
    rows, own, othersTotal, othersCount, refundTotal, refundCount,
    cardSpent, upiSpent, spent: round2(cardSpent + upiSpent),
    cardLimit, upiLimit: upi, limit: round2(cardLimit + upi),
    cardLeft: round2(cardLimit - cardSpent), upiLeft: round2(upi - upiSpent),
    left: round2(cardLimit + upi - cardSpent - upiSpent),
    // Clamped at BOTH ends: refunds can take a month's spending below zero,
    // and a negative width draws nothing while reading as a bug.
    cardPct: cardLimit > 0 ? Math.max(0, Math.min(100, (cardSpent / cardLimit) * 100)) : 0,
    upiPct: upi > 0 ? Math.max(0, Math.min(100, (upiSpent / upi) * 100)) : 0,
  };
}

// One limit strip: what it is, what has gone, and how much of it is left. Over
// the line it turns red and says by how much rather than clamping to zero,
// because "0 left" and "1,400 over" are different problems.
function pfLimitCard(label, icon, spent, limit, pct) {
  const over = round2(spent - limit);
  const left = round2(limit - spent);
  return el('div', { class: 'pf-lim' + (over > 0 ? ' is-over' : '') }, [
    el('div', { class: 'pf-lim-top' }, [
      el('span', { class: 'pf-lim-ico', text: icon }),
      el('span', { class: 'pf-lim-name', text: label }),
      el('span', { class: 'pf-lim-fig', text: fmtSheetCur(spent) + (limit > 0 ? ' / ' + fmtSheetCur(limit) : '') }),
    ]),
    el('div', { class: 'pf-lim-track' }, [
      el('span', { class: 'pf-lim-fill', style: 'width:' + Math.max(2, Math.min(100, pct)).toFixed(1) + '%' }),
    ]),
    el('div', { class: 'pf-lim-foot', text: limit <= 0
      ? 'No limit set'
      : (over > 0 ? fmtSheetCur(over) + ' over' : fmtSheetCur(left) + ' left') }),
  ]);
}

// ---------- Spends tab ----------
async function renderPfSpends(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const { byYm, allocs, cards, upiLimit } = await pfLoad();
  if (pfRenderStale(token)) return;

  const months = pfMonths(byYm, thisYm, mod);
  if (!ui._pfYm || !months.includes(ui._pfYm)) ui._pfYm = months[months.length - 1];
  const ym = ui._pfYm;
  const t = pfTotals(ym, byYm, allocs, upiLimit);
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((a, r) => a + (Number(r.amount) || 0), 0));

  // ---- Month timeline, same strip as the household Tracker ----
  const appHeader = document.querySelector('.app-header');
  const timelineWrap = el('div', {
    class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline',
    style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px',
  });
  timelineWrap.appendChild(el('div', { class: 'cc-timeline' }, months.slice().reverse().map((k) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip' + (k === ym ? ' active' : '') + (k === thisYm ? ' is-current' : '')
      + (k > thisYm ? ' is-ahead' : '') + (totalOf(k) > 0 ? ' has-data' : ''),
    text: mod.monthLabel(k),
    onclick: () => { if (k === ym) return; ui._pfYm = k; ui._pfTimelineClicked = true; renderPersonal(); },
  }))));
  host.appendChild(timelineWrap);
  _mountMonthStrip('pf', timelineWrap, ui._pfTimelineClicked);
  ui._pfTimelineClicked = false;
  _attachMonthSwipe(host, months, ym, (k) => { ui._pfYm = k; ui._pfTimelineClicked = true; renderPersonal(); });

  // ---- The two allowances ----
  host.appendChild(el('div', { class: 'pf-lims' }, [
    pfLimitCard('Card', '\ud83d\udcb3', t.cardSpent, t.cardLimit, t.cardPct),
    pfLimitCard('UPI / Cash', '\ud83d\udcf1', t.upiSpent, t.upiLimit, t.upiPct),
  ]));

  // The two halves are counted over different windows, so the windows are
  // named. Without this a September list showing a spend dated 25 Aug looks
  // like a filing mistake rather than the bill it actually lands on.
  const cycleCards = (cards || []).filter((c) => {
    const w = mod.cycleWindow(ym, c);
    return w && w.isCycle;
  });
  if (cycleCards.length) {
    const wins = cycleCards.slice(0, 3).map((c) => {
      const w = mod.cycleWindow(ym, c);
      return (c.name || 'Card') + ' ' + _spendDayLabel(w.from) + ' – ' + _spendDayLabel(w.to);
    });
    host.appendChild(el('p', { class: 'hint pf-window-note', text: 'UPI counted 1 – '
      + _daysInYm(ym) + ' ' + _SPEND_MONS[Number(ym.slice(5, 7)) - 1]
      + ' · card spends on the bill they land on: ' + wins.join(' · ')
      + (cycleCards.length > 3 ? ' · and ' + (cycleCards.length - 3) + ' more' : '') }));
  }

  // Both together, plus what a day can still take. The per-day figure is the
  // one that changes behaviour on the day, and it is only meaningful while the
  // month is still running.
  const daysLeft = _spendableDaysLeft(ym, now);
  const bits = [fmtSheetCur(t.spent) + ' of ' + fmtSheetCur(t.limit) + ' together'];
  if (t.left < 0) bits.push(fmtSheetCur(-t.left) + ' over');
  host.appendChild(el('div', { class: 'pf-both' + (t.left < 0 ? ' is-over' : ''), text: bits.join('  ·  ') }));
  // What is left per remaining day is the figure that guides a decision today, so it gets a box of its own,
  // the same number the Expense tracker shows for the household. Only while the month is still running.
  if (t.limit > 0 && t.left > 0 && daysLeft > 0) {
    host.appendChild(el('div', { class: 'pf-perday', title: fmtSheetCur(t.left) + ' across ' + perDayLabel(daysLeft) }, [
      el('span', { class: 'pf-perday-ico', text: '📅' }),
      el('span', { class: 'pf-perday-body' }, [
        el('span', { class: 'pf-perday-label', text: 'Per day left' }),
        el('span', { class: 'pf-perday-sub', text: fmtSheetCur(t.left) + ' across ' + perDayLabel(daysLeft) }),
      ]),
      el('span', { class: 'pf-perday-val', text: fmtIntCur(perDayAllowance(t.left, daysLeft)) + '/day' }),
    ]));
  }
  // The roll-up below counts these and the strips above do not, so the gap is
  // named rather than left for the user to find by subtracting.
  if (t.refundCount) {
    host.appendChild(el('p', { class: 'hint pf-refund-line', text: fmtSheetCur(t.refundTotal) + ' came back across '
      + t.refundCount + (t.refundCount === 1 ? ' refund' : ' refunds') + ' — already off the figures above.' }));
  }
  if (t.othersCount) {
    host.appendChild(el('p', { class: 'hint pf-others-note', text: fmtSheetCur(t.othersTotal) + ' across '
      + t.othersCount + (t.othersCount === 1 ? ' entry' : ' entries') + ' marked for others — listed below, '
      + 'but not counted against either limit.' }));
  }

  if (!t.rows.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\ud83d\uded2' }),
      el('p', { text: 'Nothing logged for ' + mod.monthLabel(ym) + ' yet.' }),
      el('p', { class: 'hint', text: t.limit > 0
        ? 'Tap the + to log a personal spend. Card and UPI are tracked against separate limits.'
        : 'Set your Card and UPI / Cash limits, then log a spend. Limits are optional - you can log spends without them.' }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn primary', type: 'button', text: 'Log a spend', onclick: () => openPfSpendForm(null) }),
        t.limit > 0 ? null : el('button', { class: 'btn ghost', type: 'button', text: 'Set limits', onclick: () => {
          const b = [...document.querySelectorAll('#pfBottomNav button')].find((x) => /limits/i.test(x.textContent));
          if (b) b.click();
        } }),
      ].filter(Boolean)),
    ]));
    return;
  }

  // ---- By category / Entries ----
  const seg = el('div', { class: 'seg trk-seg' }, [['category', '\ud83d\udcca By category'], ['entries', '\ud83e\uddfe Entries (' + t.rows.length + ')']]
    .map(([v, label]) => el('button', {
      type: 'button', class: ui._pfView === v ? 'active' : '', text: label,
      onclick: () => { if (ui._pfView === v) return; ui._pfView = v; renderPersonal(); },
    })));
  host.appendChild(seg);

  if (ui._pfView === 'entries') {
    const f = spendEntryFilter(t.rows, cards, ui._pfFilter, (v) => { ui._pfFilter = v; renderPersonal(); });
    ui._pfFilter = f.current;
    if (f.node) host.appendChild(f.node);
    const shown = t.rows.filter(f.matches);
    // A card filter also names that card's window for the month, which is what
    // decided which rows are in it.
    let extra = null;
    if (f.current.slice(0, 5) === 'card:' && f.current !== 'card:none') {
      const c = (cards || []).find((x) => String(x.id) === f.current.slice(5));
      const w = c ? mod.cycleWindow(ym, c) : null;
      if (w) extra = _spendDayLabel(w.from) + ' – ' + _spendDayLabel(w.to);
    }
    const note = spendFilterNote(f, shown, extra);
    if (note) host.appendChild(note);
    if (!shown.length) {
      host.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:14px 0',
        text: 'Nothing on this filter for ' + mod.monthLabel(ym) + '.' }));
      return;
    }

    const list = shown.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.id - a.id));
    const wrap = el('div', { class: 'msheet' });
    list.forEach((r) => {
      const card = cards.find((c) => c.id === r.cardId);
      const meta = [_spendDayLabel(r.date), r.method === 'Card' ? (card ? card.name : 'Card') : r.method];
      if (r.note) meta.push(r.note);
      const refunded = isRefund(r);
      const mark = refunded
        ? el('span', { class: 'pf-refund-tag', text: 'Money back' })
        : isForOthers(r) ? el('span', { class: 'pf-others-tag', text: 'Others' })
          : null;
      wrap.appendChild(el('div', { class: 'msheet-row trk-entry is-tappable'
        + (isForOthers(r) ? ' is-others' : '') + (refunded ? ' is-refund' : ''), onclick: () => openPfSpendForm(r) }, [
        el('div', { class: 'msheet-label' }, [
          el('span', { text: r.category || 'Misc' }),
          el('span', { class: 'msheet-note', text: meta.join(' · ') }),
          tagRow(r) || document.createTextNode(''),
        ]),
        // What a row IS goes in the corner, above the figure, in one or two
        // words. Both marks live here and nowhere else:
        //
        // They were sentences on lines of their own - "For others — off the
        // limits", "Money back — off the total" - each spending a whole row
        // restating what the tab already explains, on the entries it applies
        // to and nowhere else. And they sat in the left column, which ends
        // wherever the text does, so "in the corner" landed in the middle of
        // the row. In the right column they are flush with its edge and the
        // eye can run down them.
        //
        // They are mutually exclusive by nature: money already back cannot
        // also be money somebody owes you.
        el('div', { class: 'trk-entry-right' + (mark ? ' is-stacked' : '') }, [
          mark || document.createTextNode(''),
          el('div', { class: 'trk-entry-money' }, [
          el('span', { class: 'msheet-val', text: fmtSigned(r.amount) }),
          el('button', {
            class: 'icon-btn trk-del', type: 'button', text: '×', 'aria-label': 'Delete this spend',
            onclick: async (e) => {
              e.stopPropagation();   // the row opens the editor; the delete must not
              if (!(await appConfirm('Delete ' + fmtSigned(r.amount) + ' on ' + (r.category || 'Misc') + '?'))) return;
              await dropOwedRow(r);
              await DB.del('personalSpends', r.id);
              toast('Deleted');
              renderPersonal();
            },
          }),
        ]),
        ]),
      ]));
    });
    host.appendChild(wrap);
    return;
  }

  // ---- Grouped roll-up, in the order the picker shows them ----
  const byCat = new Map();
  t.rows.forEach((r) => {
    const n = r.category || 'Misc';
    const e = byCat.get(n) || { total: 0, count: 0, card: 0, upi: 0 };
    e.total = round2(e.total + (Number(r.amount) || 0));
    e.count++;
    if (r.method === 'Card') e.card = round2(e.card + (Number(r.amount) || 0));
    else e.upi = round2(e.upi + (Number(r.amount) || 0));
    byCat.set(n, e);
  });
  // Percentages here are a share of what was SPENT - every positive row in the
  // month, for-others included. Two things this is deliberately not:
  //
  //   * not the limit total - that put a for-others category at 264% of a
  //     figure it is deliberately not part of;
  //   * not the net of the month - subtracting refunds from the denominator
  //     pushed a category to 113% of a total its own money is only part of.
  //
  // Refund lines carry no percentage at all, so nothing is left unexplained by
  // leaving them out of it.
  const rollupTotal = round2(t.rows.reduce((a, r) => a + Math.max(0, Number(r.amount) || 0), 0));
  const catWrap = el('div', { class: 'trk-groups' });
  catList('pf').forEach((g) => {
    const rows = g.items.filter((n) => byCat.has(n)).map((n) => Object.assign({ name: n }, byCat.get(n)));
    // A category retired from the list but still sitting in an old month lands
    // in Other rather than disappearing along with its money.
    if (g.group === 'Other') {
      [...byCat.keys()].filter((n) => !_catMaps.pf.has(n))
        .forEach((n) => rows.push(Object.assign({ name: n }, byCat.get(n))));
    }
    if (!rows.length) return;
    const gTotal = round2(rows.reduce((a, r) => a + r.total, 0));
    const catRows = el('div', { class: 'trk-cats' });
    rows.sort((a, b) => b.total - a.total).forEach((r) => {
      // Share of the WHOLE month, not of its group - a bar filling up inside
      // its own group would make a small group's top row look like the
      // month's biggest spend.
      const back = r.total < 0;
      // A share of the month is meaningless for a line that came off it, so a
      // refund says what it is instead of quoting a negative percentage.
      const pct = !back && rollupTotal > 0 ? (r.total / rollupTotal) * 100 : 0;
      const meta = [r.count + '×'];
      if (back) meta.push('came back');
      else if (r.card > 0 && r.upi > 0) meta.push('card ' + fmtIntCur(r.card));
      else meta.push(pct.toFixed(0) + '%');
      catRows.appendChild(el('div', { class: 'trk-cat' + (back ? ' is-refund' : '') }, [
        el('div', { class: 'trk-cat-top' }, [
          el('span', { class: 'trk-cat-name' }, [el('span', { class: 'trk-cat-dot' }), el('span', { text: r.name })]),
          el('span', { class: 'trk-cat-amt', text: fmtSigned(r.total) }),
        ]),
        el('div', { class: 'trk-cat-bottom' }, [
          el('span', { class: 'trk-cat-track' }, [
            el('span', { class: 'trk-cat-fill', style: 'width:' + Math.max(2, pct).toFixed(1) + '%' }),
          ]),
          el('span', { class: 'trk-cat-meta', text: meta.join(' · ') }),
        ]),
      ]));
    });
    catWrap.appendChild(el('section', { class: 'trk-group ' + _pfGroupClass(g.group) }, [
      el('div', { class: 'trk-group-head' }, [
        el('span', { class: 'trk-group-name', text: g.group }),
        el('span', { class: 'trk-group-total', text: fmtSigned(gTotal) }),
        el('span', { class: 'trk-group-pct', text: gTotal < 0 || rollupTotal <= 0 ? ''
          : ((gTotal / rollupTotal) * 100).toFixed(0) + '%' }),
      ]),
      catRows,
    ]));
  });
  host.appendChild(catWrap);
}

// ---------- Limits tab ----------
// What the Yearly plan has not allocated yet (salary less every other line). Personal spending can draw on it.
const PLAN_LINE_KEYS = ['home', 'houseExp', 'card', 'mf', 'fd', 'indStock', 'usStock', 'metal', 'emergency', 'savings'];
const planBalanceOf = (alloc) => (alloc
  ? round2(Math.max(0, (Number(alloc.salary) || 0) - PLAN_LINE_KEYS.reduce((s, k) => s + (Number(alloc[k]) || 0), 0)))
  : 0);

async function renderPfLimits(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const { byYm, allocs, upiLimit } = await pfLoad();
  if (pfRenderStale(token)) return;
  const year = Number(thisYm.slice(0, 4));
  const alloc = (allocs || []).find((x) => Number(x.year) === year) || null;
  const cardLimit = _pfCardLimit(thisYm, allocs);
  // Card and UPI / Cash are two shares of ONE pool: the plan's Personal spending plus whatever the plan has not
  // allocated yet. Raising one lowers the other, and together they can never go above the pool. Without a plan
  // for the year there is no pool to divide, so nothing is capped (and the card figure cannot be saved anyway).
  const planBalance = planBalanceOf(alloc);
  const pool = alloc ? round2(cardLimit + planBalance) : null;
  // By default UPI / Cash starts at the unallocated balance when nothing has been saved for it.
  const upiStart = upiLimit || (alloc && planBalance > 0 ? planBalance : 0);

  // Every explanation of the two limits lives behind the i, so the form is just the two figures.
  const limInfo = 'Card a month is the Yearly plan tab\u2019s Card figure - the same number, editable from either place.\n\n'
    + 'UPI / Cash a month starts at what your plan has not allocated.'
    + (pool != null ? '\n\nCard + UPI / Cash together: up to ' + fmtSheetCur(pool) + ' (your Personal spending ' + fmtSheetCur(cardLimit)
      + ' plus ' + fmtSheetCur(planBalance) + ' not yet allocated). Raising one lowers the other.' : '');
  host.appendChild(el('h3', { class: 'div-group-head' }, [document.createTextNode('\ud83c\udfaf Monthly allowance '),
    el('button', { class: 'help-dot', type: 'button', 'aria-label': 'About the monthly allowance', text: 'i',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openInfoSheet('Monthly allowance', limInfo); } })]));

  // Both limits editable here. The card figure IS the Yearly plan tab's Card
  // line, written back to that same record - one number in one place, editable
  // from either, rather than a copy that drifts.
  const cardInp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', class: 'pf-lim-input', value: cardLimit || '' });
  const upiInp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', class: 'pf-lim-input', value: upiStart || '' });
  const saveBtn = el('button', { class: 'btn primary pf-lim-save hidden', type: 'button', text: 'Save limits' });
  const sync = () => {
    const changed = round2(num(cardInp.value) || 0) !== cardLimit || round2(num(upiInp.value) || 0) !== round2(upiLimit);
    saveBtn.classList.toggle('hidden', !changed);
  };
  // Keep the two within the pool. The box being edited is the one the person means; the other gives way.
  const keepWithinPool = (edited) => {
    if (pool == null) return;
    let c = round2(num(cardInp.value) || 0), u = round2(num(upiInp.value) || 0);
    let capped = false;
    if (edited === 'card') { if (c > pool) { c = pool; capped = true; } if (c + u > pool) u = round2(pool - c); }
    else { if (u > pool) { u = pool; capped = true; } if (c + u > pool) c = round2(pool - u); }
    cardInp.value = c || ''; upiInp.value = u || '';
    if (capped) toast('Card and UPI / Cash together cannot go above ' + fmtSheetCur(pool));
  };
  cardInp.addEventListener('input', () => { keepWithinPool('card'); sync(); });
  upiInp.addEventListener('input', () => { keepWithinPool('upi'); sync(); });
  saveBtn.addEventListener('click', async () => {
    const c = round2(num(cardInp.value) || 0);
    const u = round2(num(upiInp.value) || 0);
    if (pool != null && c + u > pool + 0.005) { toast('Card and UPI / Cash together cannot go above ' + fmtSheetCur(pool)); return; }
    if (c !== cardLimit) {
      if (!alloc) {
        // Without a row for the year there is nowhere in the household budget
        // to put it, and inventing one here would create a half-filled
        // allocation the Expense tab would then show as real.
        toast('Add ' + year + ' on the Expense Yearly plan tab first');
        return;
      }
      await DB.put('allocations', Object.assign({}, alloc, { card: c, updatedAt: new Date().toISOString() }));
    }
    if (u !== round2(upiLimit)) {
      await DB.put('meta', { key: 'pfUpiLimit', value: u, updatedAt: new Date().toISOString() });
    }
    toast('Limits updated');
    renderPersonal();
  });

  host.appendChild(el('div', { class: 'pf-lim-form' }, [
    el('div', { class: 'pf-lim-edit' }, [
      el('div', { class: 'pf-lim-edit-cell' }, [
        el('div', { class: 'pf-lim-edit-lbl', text: '\ud83d\udcb3 Card a month' }),
        cardInp,
      ]),
      el('div', { class: 'pf-lim-edit-cell' }, [
        el('div', { class: 'pf-lim-edit-lbl', text: '\ud83d\udcf1 UPI / Cash a month' }),
        upiInp,
      ]),
    ]),
    el('div', { class: 'pf-lim-form-foot' }, [saveBtn]),
  ].filter(Boolean)));

  // ---- How the months have actually gone ----
  const months = pfMonths(byYm, thisYm, mod).filter((k) => (byYm.get(k) || []).length).slice(-12).reverse();
  if (!months.length) {
    host.appendChild(el('p', { class: 'hint mf-foot', text: 'Log a few spends and this will show how each month came in against these limits.' }));
    return;
  }
  host.appendChild(el('h3', { class: 'div-group-head', text: '\ud83d\udcc6 Month by month' }));
  const rows = months.map((k) => pfTotals(k, byYm, allocs, upiLimit));
  const overCard = rows.filter((r) => r.cardLimit > 0 && r.cardSpent > r.cardLimit).length;
  const overUpi = rows.filter((r) => r.upiLimit > 0 && r.upiSpent > r.upiLimit).length;
  const table = el('div', { class: 'pf-hist' });
  table.appendChild(el('div', { class: 'pf-hist-row is-head' }, [
    el('span', { text: 'Month' }), el('span', { text: 'Card' }), el('span', { text: 'UPI' }), el('span', { text: 'Over by' }),
  ]));
  months.forEach((k, i) => {
    const r = rows[i];
    // Over the two limits TOGETHER, not the two overspends added up.
    //
    // It used to be max(0, card - cardLimit) + max(0, upi - upiLimit), which
    // charged for going over one of them while the other sat unused: 10,000
    // on a 15,000 card and 1,200 on a 1,000 UPI read as 200 over, when 11,200
    // of a 16,000 allowance had gone and nothing was over at all. The money is
    // one pot spent through two taps, so what is over is what the pot is over.
    //
    // Only answerable when the card limit is on record. A year with no
    // Allocation set has no card limit, and judging the pair against the UPI
    // figure alone would report an overspend that was never measured.
    const known = r.cardLimit > 0 && r.limit > 0;
    const over = known ? round2(Math.max(0, r.spent - r.limit)) : 0;
    table.appendChild(el('div', { class: 'pf-hist-row' + (over > 0 ? ' is-over' : '') }, [
      el('span', { text: _spendMonthLabel(k) }),
      el('span', { class: r.cardLimit > 0 && r.cardSpent > r.cardLimit ? 'is-bad' : '', text: fmtIntCur(r.cardSpent) }),
      el('span', { class: r.upiLimit > 0 && r.upiSpent > r.upiLimit ? 'is-bad' : '', text: fmtIntCur(r.upiSpent) }),
      el('span', { class: !known ? '' : over > 0 ? 'is-bad' : 'is-good',
        title: known ? fmtIntCur(r.spent) + ' of ' + fmtIntCur(r.limit) + ' together' : 'No card limit on record for this year',
        text: !known ? '—' : over > 0 ? fmtIntCur(over) : '✓' }),
    ]));
  });
  host.appendChild(table);
  host.appendChild(el('p', { class: 'hint mf-foot', text: 'Card went over in ' + overCard + ' of these ' + rows.length
    + ' months, UPI in ' + overUpi + '. Those two columns are each measured against their own limit; Over by is '
    + 'measured against the two added together, so a column can be red while Over by is clear — which is just '
    + 'one tap being used more than the other with the total still inside. Each month counts UPI over the calendar '
    + 'month and card spends over the bill they land on, so a card row here matches the statement you actually pay '
    + 'rather than a 1st-to-31st slice of it. The card limit is read from the year\u2019s Allocation, so a month '
    + 'before that year was set shows no limit rather than a false pass.' }));
}


export function buildPfBottomNav() {
  const nav = $('#pfBottomNav');
  // Rebuilt every time (like Credit Cards'): whether Card Check is locked follows the features chosen.
  nav.innerHTML = '';
  PF_TABS.forEach(([v, ico, label]) => {
    const locked = v === 'cards' && !pfCardCheckOpen();
    nav.appendChild(el('button', { 'data-view': v, class: locked ? 'is-locked' : '', onclick: () => { if (ui._pfTab === v) return; ui._pfTab = v; renderPersonal(); } },
      [el('span', { class: 'bn-ico' }, [locked ? document.createTextNode('\u{1F512}') : v === 'cards' ? cardCheckIcon() : document.createTextNode(ico)]), label]));
  });
  updatePfNavActive();
}
function updatePfNavActive() {
  $('#pfBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._pfTab));
}

export const EXP_TABS = [['spend', '🧾', 'Balance'], ['tracker', '📍', 'Tracker'], ['cat', '\u{1F4CA}', 'Category Spend'],
  ['tags', '🏷️', 'Tags'], ['alloc', '🧭', 'Allocation']];
// Bottom nav for the Expense section.
// The + FAB only means something on Credit Card (add a card), so it's hidden on
// the other two — same pattern as the Emergency Fund's Funds/Rules tabs.
export function buildExpBottomNav() {
  const nav = $('#expBottomNav');
  if (nav.childElementCount) { updateExpNavActive(); return; }
  nav.innerHTML = '';
  // Balance | Tracker | Category Spend | Tags | Allocation (v777). Review moved to the Analysis feature. Tags here is
  // household only (the personal side is under Personal Finance -> Tags); the tags themselves are on the spends and
  // were never split - each tab just reads its own side. Allocation (the yearly plan) is set once and glanced at,
  // so it sits at the far end. 'spend' is the monthly cash-flow sheet headlined by Available Balance, hence Balance.
  EXP_TABS.forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (ui._expTab === v) return; ui._expTab = v; renderHomeExpense(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateExpNavActive();
}
export function updateExpNavActive() {
  $('#expBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._expTab));
}

export const _FD_MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const _fdMonthLabel = (iso) => { const m = /^\d{4}-(\d{2})/.exec(iso || ''); return m ? _FD_MONS[+m[1] - 1] : ''; };

// Whole-rupee currency formatting (no paise) - used for FD interest figures
// (paisa precision doesn't matter, and it makes bank-statement comparisons
// easier to eyeball) and for the Home screen's summary/card figures. Everywhere
// else keeps the normal fmtCur (2 decimals).
const _intCurFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const fmtIntCur = (n) => _intCurFmt.format(Math.round(Number(n) || 0));


