import { sortCardsByCycle } from './credit.js';
import { todayISO, num } from './core.js';
import { recentCategories, usualAmounts, lastChoice, leftAfter, dayShift } from './spend-quick.js';
import { quickCategories, amountChips, dateChips, bigAmount, leftLine, leftWords, afterWords, markMissing, addedPill, stepFlow, groupHue, budgetCard } from './spend-kit.js';
import { tagsOf, tagField, knownTagsFor, catAddBtn, openCatManager, normaliseTag } from './personal-ui.js';
import { ui } from './state.js';
import { DB } from './db.js';
import { el, state, toast, closeModal, openModal, field } from './app.js';
import { _kittyFor } from './expense-review-logic.js';
import { renderHomeExpense, round2, fmtSheetCur, REFUND_CAT, fmtSigned, catList, SPEND_METHODS, _spendMonthLabel, _thisSpendYm } from './expense-ui.js';

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
  openSpendForm(_kittyFor(ym, allocs, efLoans), null, defaultDate, { budgetYm: ym });
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
// Any of the five shops: milk and fruit go on the same bill every time, whichever shop it was.
const MILK_SPLIT_FROM = ['Online Grocery', 'Flipkart Grocery', 'Amazon Grocery', 'Local Shop', 'Brigade'];
const SPLIT_PARTS = ['Milk', 'Fruits'];
// Categories are the user's to rename and delete, so each part is only offered
// when there is somewhere for it to go.
const splitPartAvailable = (cat) => catList('spend').some((g) => (g.items || []).indexOf(cat) >= 0);

// opts (all optional):
//   budgetYm  the month `budget` is for; a new entry then shows what is left of it, live
//   carry     values to start from instead of the defaults: what was typed before "+ category" opened the
//             category editor, or the date and payment kept by "Save & add"
//   added     how many "Save & add" has saved so far, for the "✓ 2 added" beside the title
//   still     reopened in place, so the sheet does not rise in again
export async function openSpendForm(budget, existing, defaultDate, opts = {}) {
  const editing = !!(existing && existing.id != null);
  const carry = opts.carry || {};
  const has = (k) => carry[k] !== undefined;
  const cards = sortCardsByCycle((await DB.all('creditCards').catch(() => [])) || []);
  // Tags in place of a note. The suggestions come from every household spend
  // already logged, which is what makes the same word get reused instead of
  // retyped four ways. The same rows say what is used most, for the quick picks.
  const allSpendRows = (await DB.all('spends').catch(() => [])) || [];
  const today = todayISO();
  const allCats = catList('spend').reduce((a, g) => a.concat(g.items || []), []);
  // A new entry starts paid the way the last one was (and on the same card, if it still exists).
  const last = editing ? null : lastChoice(allSpendRows, { methods: SPEND_METHODS, cardIds: cards.map((c) => c.id) });

  let chosenCat = has('cat') ? (allCats.indexOf(carry.cat) >= 0 ? carry.cat : null) : (editing ? existing.category : null);
  let chosenMethod = has('method') ? carry.method : editing ? (existing.method || 'UPI') : ((last && last.method) || 'UPI');
  let chosenCardId = has('cardId') ? carry.cardId : editing ? (existing.cardId != null ? existing.cardId : null) : (last ? last.cardId : null);
  if (chosenMethod !== 'Card') chosenCardId = null;

  const amount = el('input', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: '0', value: has('amount') ? carry.amount : editing ? existing.amount : '' });
  const dateInp = el('input', { type: 'date', value: has('date') ? carry.date : editing ? (existing.date || today) : (defaultDate || today) });
  const tagBox = tagField(has('tags') ? carry.tags : editing ? existing.tags : [], knownTagsFor(allSpendRows, chosenCat), 'Tags');
  // "Paid on emergency": a marker that this spend came out of an emergency, shown as a siren on its entry. It
  // changes no totals - it only says where the money came from.
  const emChk = el('input', { type: 'checkbox' });
  emChk.checked = has('fromEmergency') ? !!carry.fromEmergency : editing ? !!existing.fromEmergency : false;
  const emField = field('Paid on emergency', el('label', { class: 'switch' }, [emChk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]));

  const catBtns = [];
  // Everything typed so far rides along when "+ category" opens the category editor and this form is rebuilt.
  const draft = () => ({ fromEmergency: emChk.checked, cat: chosenCat, amount: amount.value, date: dateInp.value, method: chosenMethod, cardId: chosenCardId, tags: tagBox.peek() });
  const reopen = () => openSpendForm(budget, existing, defaultDate, Object.assign({}, opts, { carry: draft(), still: true }));
  // One place a category gets chosen, from the Recent row or the full list alike.
  const pickCat = (name) => {
    chosenCat = name;
    catBtns.forEach((x) => x.classList.toggle('active', x.textContent === name));
    quick.mark(name);
    syncMilk();
    syncRefund();
    syncAmounts();
    syncLeft();
    tagBox.reorder(knownTagsFor(allSpendRows, chosenCat));
    flow.open('amount');
    amount.focus();
  };
  const catGrid = el('div', {}, catList('spend').map((g) => el('div', { class: 'spend-cat-group', style: '--h:' + groupHue(g.group) }, [
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
      btn.addEventListener('click', () => pickCat(name));
      catBtns.push(btn);
      return btn;
    })),
  ])));
  // The categories used most lately come first; with enough of them the full list folds away. It stays open when
  // what is being edited is not one of them, so the chosen chip is always in sight.
  const recents = recentCategories(allSpendRows, { valid: allCats, exclude: [REFUND_CAT], today });
  const quick = quickCategories({
    recents, grid: catGrid, current: chosenCat, onPick: pickCat,
    hueOf: (name) => { const g = catList('spend').find((x) => (x.items || []).indexOf(name) >= 0); return groupHue(g ? g.group : name); },
    fold: recents.length >= 3 && (!chosenCat || recents.indexOf(chosenCat) >= 0),
  });
  const catBody = el('div', {}, [
    el('div', { class: 'step-tools' }, [el('span', { text: 'New category' }), catAddBtn('Add a category', () => openCatManager('spend', null, reopen))]),
    quick.node,
  ]);

  // Money coming back off the kitty, the same way it works on the personal
  // side: the amount is typed as a positive figure and stored negative, so
  // every total that already sums these rows - the month, the per-day figure,
  // what a card owes back - simply comes down by it.
  const amountField = field('Amount (\u20b9)', bigAmount(amount, () => save()));
  // The amounts usually paid for this category, one tap each.
  const amts = amountChips((a) => { amount.value = String(a); amount.dispatchEvent(new Event('input')); amount.blur(); flow.next('amount'); });
  const syncAmounts = () => amts.show(chosenCat && chosenCat !== REFUND_CAT ? usualAmounts(allSpendRows, chosenCat, { today }) : []);
  // What is left of this month's household budget, and what will be once this is in. New entries only, and only
  // while the date is in the budget's month (the budget is that month's).
  const left = leftLine();
  const budgetYm = !editing && budget > 0 && opts.budgetYm ? opts.budgetYm : null;
  const budgetLeft = budgetYm ? round2(budget - allSpendRows.filter((r) => String(r.ym || '').slice(0, 7) === budgetYm)
    .reduce((a, r) => a + (Number(r.amount) || 0), 0)) : 0;
  const cmod = budgetYm ? await import('./credit.js') : null;
  const budgetDaysLeft = (() => {
    if (!budgetYm || budgetYm !== _thisSpendYm()) return 0;
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
  })();
  const syncLeft = () => {
    if (!budgetYm) return;
    if ((dateInp.value || today).slice(0, 7) !== budgetYm) { left.set(''); return; }
    const typed = round2(Math.abs(num(amount.value) || 0));
    const after = leftAfter(budgetLeft, typed, chosenCat === REFUND_CAT);
    left.set(leftWords(fmtSheetCur, budgetLeft) + (budgetYm === _thisSpendYm() ? ' this month' : ' in ' + cmod.monthLabel(budgetYm))
      + (typed > 0 ? ' \u2192 ' + afterWords(fmtSheetCur, after) : ''), typed > 0 && after < 0);
  };
  amount.addEventListener('input', syncLeft);
  dateInp.addEventListener('change', syncLeft);
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

  // One row per part (milk, fruits): a switch, a label and the amount, shown only once switched on.
  const parts = SPLIT_PARTS.map((cat) => {
    const chk = el('input', { type: 'checkbox' });
    const amt = el('input', {
      type: 'number', inputmode: 'decimal', step: 'any', class: 'milk-amt',
      placeholder: '0', 'aria-label': cat + ' amount',
    });
    const wrap = el('div', { class: 'milk-amt-wrap hidden' }, [el('span', { class: 'milk-amt-cur', text: '₹' }), amt]);
    // The switch has to be the .switch element itself: .switch-track is
    // position:absolute;inset:0, so without that positioned parent it stretches
    // over whatever ancestor is positioned instead - which, in a modal, is the
    // whole sheet.
    const row = el('div', { class: 'milk-row' }, [
      el('label', { class: 'switch switch-sm' }, [chk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]),
      el('span', { class: 'milk-lbl', text: cat + ' on this bill' }),
      wrap,
    ]);
    return { cat, chk, amt, wrap, row };
  });
  const milkNote = el('p', { class: 'hint milk-note hidden' });
  const milkBox = el('div', { class: 'field milk-split hidden' }, parts.map((p) => p.row).concat([milkNote]));
  // The parts switched on, with their figures.
  const splitsOn = () => parts.filter((p) => p.chk.checked && !p.row.classList.contains('hidden'))
    .map((p) => ({ p, v: round2(num(p.amt.value) || 0) }));
  // What the split will actually record, worked out live - the figures are
  // the whole point, and a checkbox that only says what it does after you save
  // it is a checkbox nobody trusts.
  const syncMilkNote = () => {
    const total = round2(num(amount.value) || 0);
    const on = splitsOn();
    milkNote.classList.toggle('hidden', !on.length);
    if (!on.length) return;
    if (!(total > 0)) { milkNote.textContent = 'Enter the bill total above first.'; return; }
    const blank = on.find((x) => !(x.v > 0));
    if (blank) { milkNote.textContent = 'How much of the ' + fmtSheetCur(total) + ' was ' + blank.p.cat.toLowerCase() + '?'; return; }
    const sum = round2(on.reduce((a, x) => a + x.v, 0));
    if (sum >= total) {
      milkNote.textContent = 'That is the whole bill \u2014 pick ' + (on.length === 1 ? on[0].p.cat : 'one category') + ' as the category instead.';
      return;
    }
    milkNote.textContent = fmtSheetCur(round2(total - sum)) + ' to ' + (chosenCat || 'the shop')
      + on.map((x) => ' · ' + fmtSheetCur(x.v) + ' to ' + x.p.cat).join('') + ', tagged “' + normaliseTag(chosenCat || '')
      + '” · same date and payment.';
  };
  const syncMilk = () => {
    const avail = parts.filter((p) => splitPartAvailable(p.cat));
    const offer = !editing && chosenCat !== REFUND_CAT && MILK_SPLIT_FROM.indexOf(chosenCat) >= 0 && avail.length > 0;
    milkBox.classList.toggle('hidden', !offer);
    parts.forEach((p) => {
      const show = offer && avail.indexOf(p) >= 0;
      p.row.classList.toggle('hidden', !show);
      if (!show) { p.chk.checked = false; p.amt.value = ''; }
      p.wrap.classList.toggle('hidden', !p.chk.checked);
    });
    syncMilkNote();
  };
  parts.forEach((p) => {
    p.chk.addEventListener('change', () => {
      p.wrap.classList.toggle('hidden', !p.chk.checked);
      syncMilkNote();
      if (p.chk.checked) p.amt.focus();
    });
    p.amt.addEventListener('input', syncMilkNote);
  });
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
      if (chosenCardId != null) flow.next('pay');
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
      if (m !== 'Card') { chosenCardId = null; cardBtns.forEach((x) => x.classList.remove('active')); flow.next('pay'); }
    });
    methodBtns.push(btn);
    return btn;
  }));

  let saving = false;
  // next: "Save & add" - saved exactly the same way, then the form opens again for the next spend, keeping the
  // date and how it was paid.
  const save = async (next = false) => {
    if (saving) return;
    if (!chosenCat) { toast('Pick a category'); flow.open('cat'); markMissing(flow.stepNode('cat')); return; }
    // Typed as a positive figure either way; the sign goes on here, once, and
    // every sum downstream is then simply right - see REFUND_CAT.
    const typed = round2(Math.abs(num(amount.value) || 0));
    if (!(typed > 0)) { toast('Enter an amount'); flow.open('amount'); markMissing(amountField); amount.focus(); return; }
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
      method: chosenMethod, cardId, tags: tagBox.get(), fromEmergency: emChk.checked || undefined,
      // A note written before tags existed is kept, not quietly dropped. It
      // still shows on the row; there is just no longer a box to write a new
      // one in.
      note: editing && existing.note ? existing.note : null,
      createdAt: editing ? (existing.createdAt || nowIso) : nowIso, updatedAt: nowIso,
    };
    // The parts (milk, fruits) come OFF the amount typed, because what was typed is the bill:
    // adding them on top instead would record more than was actually paid.
    const splits = splitsOn();
    for (const x of splits) {
      if (!(x.v > 0)) { toast('Enter the ' + x.p.cat.toLowerCase() + ' amount'); flow.open('amount'); markMissing(milkBox); x.p.amt.focus(); return; }
    }
    const splitSum = round2(splits.reduce((a, x) => a + x.v, 0));
    if (splits.length && splitSum >= typed) {
      toast((splits.length === 1 ? splits[0].p.cat : 'The split') + ' is the whole ' + fmtSheetCur(typed) + ' \u00b7 pick ' + (splits.length === 1 ? splits[0].p.cat : 'one category') + ' as the category instead');
      markMissing(milkBox);
      return;
    }
    rec.amount = round2(amt - splitSum);

    if (editing) rec.id = existing.id;
    // A second tap while this saves must not add it twice (Done on the keyboard and the button, say).
    saving = true;
    await DB.put('spends', rec).catch((err) => { saving = false; throw err; });
    for (const x of splits) {
      // Same trip, same payment: everything is carried over but the category
      // and the figure. No id - this is a second row, never an overwrite.
      //
      // Plus a tag naming where it was bought. Without it the row is
      // stranded from the trip it came off, and "was the Brigade milk dearer
      // than the local shop's" - the question the split exists to make
      // askable - stays unanswerable. It goes FIRST so that a trip already
      // carrying the maximum number of tags loses one of those to the cap
      // rather than losing this one.
      const tags = tagsOf({ tags: [normaliseTag(chosenCat)].concat(rec.tags || []) });
      const partRec = Object.assign({}, rec, { category: x.p.cat, amount: x.v, tags, createdAt: nowIso });
      delete partRec.id;
      await DB.put('spends', partRec);
    }
    closeModal();
    toast((editing ? 'Updated ' : 'Added ') + fmtSigned(rec.amount)
      + splits.map((x) => ' · ' + fmtSheetCur(x.v) + ' to ' + x.p.cat).join('')
      + (chosenMethod === 'Card' ? ' · on the card reimbursement' : ''));
    renderHomeExpense();
    if (opts.onSaved) opts.onSaved();
    if (next) {
      openSpendForm(budget, null, defaultDate, Object.assign({}, opts, {
        carry: { date: d, method: chosenMethod, cardId }, added: (opts.added || 0) + 1, still: true,
      }));
    }
  };

  // Category -> amount -> date -> paid by -> tags, one step open at a time. Date and payment start filled
  // (today, and however the last one was paid), so the usual entry is: tap a category, type the amount, Save.
  const yest = dayShift(today, -1);
  const cardName = () => { const c = cards.find((x) => x.id === chosenCardId); return c ? c.name || 'Card' : ''; };
  const amountNext = el('button', { type: 'button', class: 'btn small step-next', text: 'Next \u203a', onclick: () => flow.next('amount') });
  const flow = stepFlow([
    { key: 'cat', label: 'Category', body: catBody, summary: () => chosenCat || '' },
    { key: 'amount', label: 'Amount', body: el('div', {}, [amountField, amts.node, left.node, refundNote, milkBox, amountNext]),
      summary: () => { const v = round2(Math.abs(num(amount.value) || 0)); return v > 0 ? (chosenCat === REFUND_CAT ? 'Refund ' : '') + fmtSheetCur(v) : ''; } },
    { key: 'date', label: 'Date', body: dateChips(dateInp, today),
      summary: () => { const v = dateInp.value; if (!v) return ''; return v === today ? 'Today' : v === yest ? 'Yesterday' : new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } },
    { key: 'pay', label: 'Paid by', body: el('div', {}, [methodRow, cardField]),
      summary: () => chosenMethod + (chosenMethod === 'Card' && cardName() ? ' \u00b7 ' + cardName() : '') },
    { key: 'tags', label: 'Tags', body: el('div', {}, [tagBox.node, emField]), optional: true,
      summary: () => (tagBox.peek() || []).join(', ') + (emChk.checked ? ((tagBox.peek() || []).length ? ' · ' : '') + '🚨 on emergency' : '') },
  ], chosenCat ? 'amount' : 'cat');
  dateInp.addEventListener('change', () => flow.next('date'));

  syncMilk();
  syncRefund();
  syncAmounts();
  syncLeft();

  const sheet = el('div', { class: 'sheet has-fixed-footer quick-form' + (opts.still ? ' no-rise' : '') }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { class: 'quick-title' }, [document.createTextNode(editing ? 'Edit House Expense' : 'Add House Expense'), addedPill(opts.added)].filter(Boolean)),
      budgetYm ? budgetCard({ fmt: fmtSheetCur, budget, left: budgetLeft, daysLeft: budgetDaysLeft })
        : el('p', { class: 'hint', text: budget > 0 ? 'Comes off the ' + fmtSheetCur(budget) + ' household budget.' : 'No House Exp allocation set yet — this is still logged.' }),
      flow.node,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: () => save() }),
      editing ? null : el('button', { class: 'btn quick-next', type: 'button', text: 'Save & add', title: 'Save this one and add another', onclick: () => save(true) }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ].filter(Boolean))]),
  ]);
  openModal(sheet);
}
