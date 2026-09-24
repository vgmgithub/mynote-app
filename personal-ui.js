import { DB } from './db.js';
import { ENV, IS_PRODUCTION } from './config.js';
import { todayISO, num, thisYm, fmtCur, fmtIntRate, pctClass, fmtPct } from './core.js';
import { ui } from './state.js';
import { isFixedCategory, stepProgress } from './get-started.js';
import { recentCategories, usualAmounts, lastChoice, leftAfter } from './spend-quick.js';
import { quickCategories, amountChips, dateChips, bigAmount, leftLine, leftWords, afterWords, markMissing, addedPill } from './spend-kit.js';
import { openLoanEntries, openAllocFormForThisYear } from './expense-ui.js';
import { _mfCell, _mfValueCard, openMF } from './mf-ui.js';
import { openMetal } from './metals-ui.js';
import { openBond } from './bonds-ui.js';
import { openEmergency } from './ef.js';
import { _eligibleDividendRecords, openDividend } from './divs-ui.js';
import { getUserName, greetingFor, openNameEditor, el, catList, REFUND_CAT, field, PF_METHODS, toast, round2, syncOwedRow, isOwedRow, closeModal, fmtSheetCur, appConfirm, dropOwedRow, openModal, formSection, CAT_KINDS, saveCategoryList, b, SPEND_METHODS, state, $, renderTagAnalysis, _pfUpiLimit, PF_START_YM, isRefund, _pfCardLimit, pfRenderStale, _mountMonthStrip, _attachMonthSwipe, _spendDayLabel, _daysInYm, _SPEND_MONS, _spendableDaysLeft, perDayAllowance, perDayLabel, fmtSigned, _catMaps, _pfGroupClass, _spendMonthLabel, _reviewAnalysis, _pfGroupOf, _rvwScopeLine, REVIEW_MIN_HISTORY, _reviewCycle, _reviewForecast, _reviewSavings, _reviewSmallTickets, _smallTicketUsual, rvwSection, _reviewCurve, _rvwCurveChart, _ordinalSuffix, explainRow, _rvwMonthBars, _catMonthHistory, _rvwCreepingSection, _reviewCreeping, _rvwMethodsSection, _reviewMethods, _rvwFitSection, _reviewKittyFit, renderHomeExpense, updateFdNavActive, refresh, moreOptions, modOn, _modsCache, isSgb, metalPortfolio, _gramsShort, openBackupSheet, setAppMode, getEnabledModules, APP_VERSION, _homeCard, _walletIcon, _homeLiveRatesStrip, _kittyFor, _perDayBadge, debounce, APP_MODULES, moduleIcon, _renewalBanner, liveCountdown } from './app.js';
import { sameMoment } from './pay-core.js';

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
  const cards = (await DB.all('creditCards').catch(() => [])) || [];
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
  const draft = () => ({ cat: chosenCat, amount: amount.value, date: dateInp.value, method: chosenMethod, cardId: chosenCardId, tags: tagBox.get(), forOthers: chosenForOthers });
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
    amount.focus();
  };
  const catGrid = el('div', {}, catList('pf').map((g) => el('div', { class: 'spend-cat-group' }, [
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
    fold: recents.length >= 3 && (!chosenCat || recents.indexOf(chosenCat) >= 0),
  });

  // The form says which way the money is going, rather than leaving the user to
  // work it out from the category they picked.
  const amountField = field('Amount (₹)', bigAmount(amount, () => save()));
  const amts = amountChips((a) => { amount.value = String(a); amount.dispatchEvent(new Event('input')); amount.blur(); });
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
  othersChk.addEventListener('change', () => { chosenForOthers = othersChk.checked; syncLeft(); });
  const othersField = field('For others', el('div', {}, [
    el('label', { class: 'switch' }, [othersChk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]),
    el('p', { class: 'hint', style: 'margin:6px 0 0',
      text: 'Money spent for somebody who will pay it back. Still listed and still on the card\u2019s bill, but kept out of the two limits and out of Review.' }),
  ]));

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
  const syncLeft = () => {
    if (!pf) return;
    if (chosenForOthers) { left.set('For others \u00b7 kept out of your limits'); return; }
    const d = (dateInp.value || today).slice(0, 10);
    const card = chosenMethod === 'Card';
    const ym = pfCountedYm({ date: d, method: chosenMethod, cardId: card ? chosenCardId : null }, pf.cards, cmod);
    const t = pfTotals(ym, pf.byYm, pf.allocs, pf.upiLimit);
    const limit = card ? t.cardLimit : t.upiLimit;
    if (!(limit > 0)) { left.set(''); return; }
    const now = card ? t.cardLeft : t.upiLeft;
    const typed = round2(Math.abs(num(amount.value) || 0));
    const after = leftAfter(now, typed, chosenCat === REFUND_CAT);
    left.set((card ? 'Card' : 'UPI / Cash') + ' \u00b7 ' + leftWords(fmtSheetCur, now) + ' for ' + cmod.monthLabel(ym)
      + (typed > 0 ? ' \u2192 ' + afterWords(fmtSheetCur, after) : ''), typed > 0 && after < 0);
  };
  amount.addEventListener('input', syncLeft);
  dateInp.addEventListener('change', syncLeft);

  let saving = false;
  // next: "Save & add" - saved exactly the same way, then the form opens again for the next spend, keeping the
  // date and how it was paid.
  const save = async (next = false) => {
    if (saving) return;
    if (!chosenCat) { toast('Pick a category'); markMissing(catSection); return; }
    const typed = round2(Math.abs(num(amount.value) || 0));
    if (!(typed > 0)) { toast('Enter an amount'); markMissing(amountField); amount.focus(); return; }
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
      tags: tagBox.get(),
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
  };

  syncRefund();
  syncAmounts();
  syncLeft();

  const btns = [el('button', { class: 'btn primary', text: editing ? 'Save' : 'Add spend', onclick: () => save() })];
  if (editing) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  else btns.push(el('button', { class: 'btn quick-next', type: 'button', text: 'Save & add', title: 'Save this one and add another', onclick: () => save(true) }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));

  const catSection = formSection('\ud83c\udff7\ufe0f', 'What for', [
    el('div', { class: 'cat-head-row' }, [
      el('span', { class: 'cat-head-label', text: 'Category' }),
      catAddBtn('Add a category', () => openCatManager('pf', null, reopen)),
    ]),
    quick.node,
  ]);
  // The amount is no longer focused on open: the keyboard would cover the categories, which come first. Picking
  // one puts the cursor in the amount, the same as the household form.
  openModal(el('div', { class: 'sheet has-fixed-footer quick-form' + (opts.still ? ' no-rise' : '') }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { class: 'quick-title' }, [document.createTextNode(editing ? 'Edit personal spend' : 'Personal spend'), addedPill(opts.added)].filter(Boolean)),
      el('div', { class: 'form-secs' }, [
        catSection,
        formSection('\ud83d\udcb0', 'How much', [
          amountField,
          amts.node,
          refundNote,
          field('Date', dateChips(dateInp, today)),
          field('Paid by', methodRow),
          left.node,
          cardField,
          othersField,
        ]),
        formSection('🏷️', 'Tags', [tagBox.node]),
      ]),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}

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
  if (ui._pfTab === 'cards') ui._pfTab = 'spends'; // the Card check now lives on Credit Cards
  if (ui._pfTab === 'limits') { await renderPfLimits(host, token); return; }
  if (ui._pfTab === 'review') { await renderPfReview(host, token); return; }
  if (ui._pfTab === 'tags') { await renderTagAnalysis(host, token); return; }
  await renderPfSpends(host, token);
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
function pfCountedYm(r, cards, mod) {
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
function pfOwnMap(byYm) {
  const out = new Map();
  byYm.forEach((rows, k) => {
    const own = rows.filter((r) => !isForOthers(r));
    if (own.length) out.set(k, own);
  });
  return out;
}

async function pfLoad() {
  const mod = await import('./credit.js');
  const [rows, allocs, cards, upiLimit] = await Promise.all([
    DB.all('personalSpends').catch(() => []),
    DB.all('allocations').catch(() => []),
    DB.all('creditCards').catch(() => []),
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
function pfMonths(byYm, thisYm, mod) {
  const range = mod.monthRangeYm(PF_START_YM, thisYm).filter((k) => k <= thisYm);
  const out = [...new Set(range.concat([...byYm.keys()], [thisYm]))].sort();
  return out.length ? out : [thisYm];
}

// Card and UPI, each against its own allowance. Returned together because
// every tab here reads both: two limits that are only ever half-checked is how
// a month comes in "under" while the card is 3,000 over.
function pfTotals(ym, byYm, allocs, upiLimit) {
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

  host.appendChild(el('h3', { class: 'div-group-head', text: '\ud83c\udfaf Monthly allowance' }));

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
        el('div', { class: 'pf-lim-edit-sub', text: 'This is the Yearly plan tab\u2019s Card figure' }),
      ]),
      el('div', { class: 'pf-lim-edit-cell' }, [
        el('div', { class: 'pf-lim-edit-lbl', text: '\ud83d\udcf1 UPI / Cash a month' }),
        upiInp,
        el('div', { class: 'pf-lim-edit-sub', text: 'Starts at what your plan has not allocated' }),
      ]),
    ]),
    pool != null ? el('p', { class: 'hint pf-lim-pool', text: 'Card + UPI / Cash together: up to ' + fmtSheetCur(pool)
      + ' (your Personal spending ' + fmtSheetCur(cardLimit) + ' plus ' + fmtSheetCur(planBalance) + ' not yet allocated). '
      + 'Raising one lowers the other.' }) : null,
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

// ---------- Review tab ----------
// Reuses the household Review's engine - the forecast, the shape of a month,
// the median comparison - because none of it knows or cares whose money it is.
// The only thing passed differently is the group resolver, so a personal
// category is coloured and grouped by the personal list.
async function renderPfReview(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const { byYm, byYmCal, allocs, upiLimit } = await pfLoad();
  if (pfRenderStale(token)) return;

  // The whole tab is about own spending: what is unusual for you, where your
  // month lands, where you could keep money. A spend that is coming back is
  // none of those, so it is out of every figure here.
  const ownByYm = pfOwnMap(byYm);
  const ownByYmCal = pfOwnMap(byYmCal);

  // THIS MONTH, always, and no strip - the same reasoning as the household
  // Review: this tab is for a month that can still be changed. History is what
  // the comparisons are made against, not something to page through.
  const ym = thisYm;
  const t = pfTotals(ym, byYm, allocs, upiLimit);

  const a = _reviewAnalysis(ym, ownByYm, thisYm, t.limit, now, _pfGroupOf);

  _rvwScopeLine(host, mod, ym, a, ownByYm);

  if (!a.spent) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\ud83d\udd0d' }),
      el('p', { text: 'Nothing logged this month yet.' }),
      el('p', { class: 'hint', text: 'This tab reads your own Spends and only ever looks at the month you are in — '
        + 'log some and it will forecast where the month lands and tell you which of them are unusual for you.' }),
    ]));
    return;
  }

  host.appendChild(el('div', { class: 'rvw-head' }, [
    el('div', { class: 'rvw-head-fig' + (a.overKitty > 0 ? ' is-over' : '') },
      [fmtSheetCur(a.spent) + (t.limit > 0 ? ' of ' + fmtSheetCur(t.limit) : '')]),
    el('div', { class: 'rvw-head-note', text: [
      t.limit > 0 ? (a.overKitty > 0 ? 'Over the allowance by ' + fmtSheetCur(a.overKitty) : fmtSheetCur(-a.overKitty) + ' still allowed') : null,
      a.isCurrent ? perDayLabel(a.daysLeft + 1) : null,
      t.othersCount ? fmtSheetCur(t.othersTotal) + ' for others, not counted' : null,
    ].filter(Boolean).join(' · ') }),
  ]));

  if (a.historyMonths < REVIEW_MIN_HISTORY) {
    host.appendChild(el('div', { class: 'rvw-thin' }, [
      el('div', { class: 'rvw-thin-head', text: 'Not enough history yet' }),
      el('div', { class: 'rvw-thin-sub', text: 'There ' + (a.historyMonths === 1 ? 'is 1 earlier month' : 'are ' + a.historyMonths + ' earlier months')
        + ' on record. Comparing a category against its own normal needs at least ' + REVIEW_MIN_HISTORY
        + ', so this holds off rather than calling something unusual on one data point.' }),
    ]));
    return;
  }

  // Totals and per-category comparisons run on the COUNTED months above, so
  // they agree with the Spends and Limits tabs.
  //
  // The forecast and the spending cycle run on calendar days instead, and say
  // so on screen. A day-of-month curve is only defined on a calendar month:
  // inside one counted month a 21-20 card is 15 days into its own window while
  // the calendar is on the 4th, and there is no single "today" across two
  // cards on different cycles. Reading those two sections on calendar days
  // keeps every figure in them computable and honest.
  const cycle = _reviewCycle(ym, ownByYmCal, now, a.isCurrent);
  const forecast = a.isCurrent ? _reviewForecast(ym, ownByYmCal, now, 0, t.limit) : null;
  const savings = _reviewSavings(a, cycle, _reviewSmallTickets(ym, ownByYm), _smallTicketUsual(ym, ownByYm));

  if (forecast) {
    const f = forecast;
    const grade = el('span', { class: 'rvw-grade is-' + f.grade,
      text: f.errPct != null ? f.grade + ' · \u00b1' + f.errPct + '%' : f.grade });
    rvwSection(host, 'pf-forecast', '\ud83d\udd2e', 'Where this month lands', grade, (body) => {
      const curve = _reviewCurve(ym, ownByYmCal, f.day);
      body.appendChild(el('div', { class: 'rvw-fc' }, [
        el('div', { class: 'rvw-fc-top' }, [
          el('div', {}, [
            el('div', { class: 'rvw-fc-big' + (f.overKitty > 0 ? ' is-over' : ''), text: fmtSheetCur(f.forecast) }),
            el('div', { class: 'rvw-fc-lbl', text: 'forecast for ' + mod.monthLabel(ym) }),
          ]),
          el('div', { class: 'rvw-fc-range' }, [
            el('div', { class: 'rvw-fc-range-lbl', text: 'likely between' }),
            el('div', { class: 'rvw-fc-range-val', text: fmtSheetCur(f.lo) + ' – ' + fmtSheetCur(f.hi) }),
          ]),
        ]),
        curve ? el('div', { class: 'rvw-chart' }, [_rvwCurveChart(curve, { kitty: t.limit, forecast: f.forecast, limitLabel: 'allowance' })]) : document.createTextNode(''),
        el('div', { class: 'rvw-fc-split' }, [
          el('span', {}, [el('i', { class: 'rvw-dot is-spent' }), fmtSheetCur(f.spent) + ' spent']),
          el('span', {}, [el('i', { class: 'rvw-dot is-proj' }), fmtSheetCur(f.rest) + ' to come']),
          el('span', {}, [el('i', { class: 'rvw-dot is-usual' }), 'a usual month']),
        ]),
      ]));
      const lines = [];
      if (f.restPerDay != null) lines.push(['-', 'The rest of your month usually costs ' + fmtIntCur(f.restPerDay) + ' a day · the ' + f.daysLeft + (f.daysLeft === 1 ? ' day' : ' days') + ' after today']);
      if (f.fitPerDay != null) {
        lines.push(f.fitPerDay > 0
          ? ['OK', fmtIntCur(f.fitPerDay) + ' a day for the ' + perDayLabel(f.fitDays)
              + ', to stay inside the ' + fmtSheetCur(t.limit) + ' allowance']
          : ['NO', 'The allowance is already spent · anything from here is over it']);
      }
      if (f.overKitty != null && f.overKitty > 0) lines.push(['NO', 'On this estimate the month ends ' + fmtSheetCur(f.overKitty) + ' over']);
      else if (f.overKitty != null) lines.push(['OK', 'On this estimate the month ends ' + fmtSheetCur(-f.overKitty) + ' inside the allowance']);
      if (f.usualByNow > 0) {
        lines.push([f.vsUsualByNow > 0 ? 'UP' : 'DOWN', 'By the ' + f.day + _ordinalSuffix(f.day)
          + ' a usual month is at ' + fmtIntCur(f.usualByNow) + ' · you are ' + fmtIntCur(Math.abs(f.vsUsualByNow))
          + (f.vsUsualByNow > 0 ? ' above that' : ' below that')]);
      }
      body.appendChild(el('div', { class: 'rvw-lines' }, lines.map(([kind, text]) => el('div', { class: 'rvw-line is-' + kind.toLowerCase() }, [
        el('span', { class: 'rvw-line-mark', text: kind === 'OK' ? '✓' : kind === 'NO' ? '!' : kind === 'UP' ? '\u2191' : kind === 'DOWN' ? '\u2193' : '\u2022' }),
        el('span', { text }),
      ]))));
      body.appendChild(explainRow('How the forecast works', (f.errPct != null
        ? 'Only the remainder is estimated, priced from what the same days cost in your last ' + f.months
          + ' months. Tested against those months at the same point, it came out a median ' + f.errPct + '% out.'
        : 'Only the remainder is estimated, priced from what the same days cost in your last ' + f.months
          + ' months. Too few months to have tested it yet.')
        + ' Counted on CALENDAR days, unlike the totals above — a day-of-month curve needs one month with one '
        + 'set of days in it, and two cards on different cycles do not share one.', 'About this estimate'));
    });
  }

  if (savings.rows.length) {
    rvwSection(host, 'pf-savings', '\ud83d\udca1', 'Where you could keep money',
      savings.rows.length + (savings.rows.length === 1 ? ' place' : ' places'), (body) => {
        body.appendChild(el('div', { class: 'rvw-save-list' }, savings.rows.map((r) => el('div', { class: 'rvw-save-row ' + _pfGroupClass(r.group) }, [
          el('div', { class: 'rvw-save-body' }, [
            el('div', { class: 'rvw-save-name', text: r.name }),
            el('div', { class: 'rvw-save-how', text: r.how }),
          ]),
          el('div', { class: 'rvw-save-fig' }, [
            el('div', { class: 'rvw-save-val', text: r.kind === 'weekend' ? fmtIntCur(r.save) : fmtSheetCur(r.save) }),
            el('div', { class: 'rvw-save-unit', text: r.kind === 'weekend' ? 'a day' : 'this month' }),
          ]),
        ]))));
      });
  }

  rvwSection(host, 'pf-look', '\u26a0\ufe0f', 'Worth a look',
    a.actionable.length ? fmtSheetCur(a.recoverable) : 'nothing unusual', (body) => {
      if (!a.actionable.length) {
        body.appendChild(el('div', { class: 'rvw-clear' }, [
          el('span', { text: '\u2705' }),
          el('div', {}, [
            el('div', { class: 'rvw-clear-head', text: 'Nothing unusual this month' }),
            el('div', { class: 'rvw-clear-sub', text: 'Every category is at or below its own normal.' }),
          ]),
        ]));
        return;
      }
      const wrap = el('div', { class: 'rvw-list' });
      a.actionable.forEach((r) => {
        const detail = el('div', { class: 'rvw-item-detail hidden' });
        let built = false;
        const bits = [r.count + '× this month'];
        if (r.usualCount) bits.push('usually ' + r.usualCount + '×');
        if (r.driver) bits.push(r.driver);
        const item = el('div', { class: 'rvw-item is-tappable ' + _pfGroupClass(r.group) }, [
          el('div', { class: 'rvw-item-top' }, [
            el('span', { class: 'rvw-item-name' }, [el('span', { class: 'rvw-item-dot' }), el('span', { text: r.name })]),
            el('span', { class: 'rvw-item-amt', text: fmtSheetCur(r.now) }),
          ]),
          el('div', { class: 'rvw-item-mid', text: 'Usually ' + fmtSheetCur(r.usual) + ' a month · ' + bits.join(' · ') }),
          el('div', { class: 'rvw-item-save' }, [
            el('span', { class: 'rvw-save-amt', text: fmtSheetCur(r.over) }),
            el('span', { class: 'rvw-save-txt', text: 'above a normal month' }),
          ]),
          detail,
        ]);
        item.addEventListener('click', () => {
          if (!built) { detail.appendChild(_rvwMonthBars(_catMonthHistory(r.name, ym, ownByYm, 6), r.usual)); built = true; }
          const closed = detail.classList.toggle('hidden');
          item.classList.toggle('is-open', !closed);
        });
        wrap.appendChild(item);
      });
      body.appendChild(wrap);
      body.appendChild(el('div', { class: 'rvw-total' }, [
        el('span', { class: 'rvw-total-label', text: 'Recoverable this month' }),
        el('span', { class: 'rvw-total-val', text: fmtSheetCur(a.recoverable) }),
      ]));
    });

  if (cycle) {
    rvwSection(host, 'pf-cycle', '\ud83d\udd01', 'Your spending cycle',
      cycle.halfBy ? 'half gone by the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy) : null, (body) => {
        if (cycle.perDow && cycle.perDow.some((d) => d.perDay > 0)) {
          const peak = cycle.perDow.reduce((m, d) => Math.max(m, d.perDay), 1);
          body.appendChild(el('div', { class: 'rvw-dow' }, cycle.perDow.map((d) => el('div', {
            class: 'rvw-dow-cell' + (d.i === 0 || d.i === 6 ? ' is-weekend' : ''),
          }, [
            el('span', { class: 'rvw-dow-amt', text: d.perDay > 0 ? fmtIntCur(d.perDay) : '\u2014' }),
            el('span', { class: 'rvw-dow-track' }, [
              el('span', { class: 'rvw-dow-fill', style: 'height:' + Math.max(2, (d.perDay / peak) * 100).toFixed(1) + '%' }),
            ]),
            el('span', { class: 'rvw-dow-lbl', text: d.name.slice(0, 3) }),
          ]))));
        }
        const rows = [];
        if (cycle.halfBy) rows.push(['Half a month is gone by', 'the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy)]);
        if (cycle.weekendPerDay > 0) rows.push(['Weekend vs weekday, per day', fmtIntCur(cycle.weekendPerDay) + ' vs ' + fmtIntCur(cycle.weekdayPerDay)]);
        if (cycle.weekendShare != null) rows.push(['Lands on a Saturday or Sunday', cycle.weekendShare + '% of a month']);
        rows.push(['Days with nothing spent', a.isCurrent
          ? cycle.noSpendSoFar + ' of the first ' + cycle.daysSoFar + ' · usually ' + cycle.noSpendTypical + ' in a month'
          : 'usually ' + cycle.noSpendTypical + ' in a month']);
        body.appendChild(el('div', { class: 'rvw-flat' }, rows.map(([k, v]) =>
          el('div', { class: 'rvw-flat-row' }, [el('span', { text: k }), el('span', { class: 'rvw-flat-meta', text: v })]))));
        body.appendChild(explainRow('Your spending cycle', 'Counted on calendar days, for the same reason '
          + 'as the forecast: which day of the month you spend on is a question about the calendar, not '
          + 'about a card\u2019s billing cycle.', 'How this is measured'));
      });
  }

  // The same three the household tab draws, on personal money: what is
  // drifting upward, how it was paid, and whether the allowance is the right
  // size to begin with. Together with the forecast above, that is the whole
  // question this tab exists to answer - am I going to land inside my limit,
  // and if not, what is doing it.
  const prevD = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYm = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
  _rvwCreepingSection(host, _reviewCreeping(ym, ownByYm, _pfGroupOf), _pfGroupClass);
  _rvwMethodsSection(host, _reviewMethods(ym, ownByYm, prevYm),
    ' Card spends are counted on the statement they land on, so a late-month swipe '
    + 'is next month\u2019s allowance rather than this one\u2019s.');
  _rvwFitSection(host, _reviewKittyFit(ym, ownByYm, (k) => pfTotals(k, byYm, allocs, upiLimit).limit, thisYm), {
    word: 'allowance',
    each: () => ' — the card half of that is set on Expense’s Yearly plan tab, the UPI half on Limits',
  });

  host.appendChild(explainRow('How this tab reads your months', 'Each category is compared with its own median month from your own entries — not a target, and not an average, which one unusual month would skew. Month totals count UPI over the calendar month and card spends over the bill they land on, matching the Spends and Limits tabs.', 'About these figures'));
}

// ---------- Card check tab ----------
// The reason this section exists: a card statement contains household spending
// AND personal spending, so neither tracker on its own can say whether the bill
// adds up. This puts both against the statement and names the gap.
//
// Nothing here writes to a card. The billed figure IS the statement, and a
// logged spend is already inside it by the time the statement arrives - adding
// it again would charge the same swipe twice. So the two are compared, not
// summed into each other.
// o.rerender / o.stale let another screen (Credit Cards) host it; Personal passes nothing.
export async function renderPfCardCheck(host, token, o) {
  const rerender = (o && o.rerender) || renderPersonal, stale = (o && o.stale) || pfRenderStale;
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const [{ rows: pRows, byYm, cards }, houseRows] = await Promise.all([pfLoad(), DB.all('spends').catch(() => [])]);
  if (stale(token)) return;

  // One month PAST the current one, unlike the other tabs. A cycle that closes
  // on the 7th means a swipe today is on next month's bill, and the statement
  // being accumulated right now has to be reachable or the newest spends look
  // as though they went nowhere.
  const nd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextYm = nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0');
  // Deduped, because pfMonths ALREADY reaches past this month whenever a spend
  // lands on a statement that closes next month - which is exactly the case
  // this tab adds nextYm for. Appending it blindly then listed it twice, and a
  // repeated month also breaks the strip's swipe, which steps by indexOf.
  const months = [...new Set(pfMonths(byYm, thisYm, mod).concat([nextYm]))].sort();
  if (!ui._pfYm || !months.includes(ui._pfYm)) ui._pfYm = thisYm;
  const ym = ui._pfYm;

  // Same month strip as the other tabs. It matters more here than anywhere:
  // each card's statement window is derived from the month picked, so without
  // it there is no way to look at anything but the latest bill.
  const appHeader = document.querySelector('.app-header');
  const timelineWrap = el('div', {
    class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline',
    style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px',
  });
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  timelineWrap.appendChild(el('div', { class: 'cc-timeline' }, months.slice().reverse().map((k) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip' + (k === ym ? ' active' : '') + (k === thisYm ? ' is-current' : '')
      + (k > thisYm ? ' is-ahead' : '') + (totalOf(k) > 0 ? ' has-data' : ''),
    text: mod.monthLabel(k),
    onclick: () => { if (k === ym) return; ui._pfYm = k; ui._pfTimelineClicked = true; rerender(); },
  }))));
  host.appendChild(timelineWrap);
  _mountMonthStrip('pfcards', timelineWrap, ui._pfTimelineClicked);
  ui._pfTimelineClicked = false;
  _attachMonthSwipe(host, months, ym, (k) => { ui._pfYm = k; ui._pfTimelineClicked = true; rerender(); });

  host.appendChild(el('h3', { class: 'div-group-head', text: '\ud83e\uddfe ' + mod.monthLabel(ym) + ' against your statements' }));

  if (!cards.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\ud83d\udcb3' }),
      el('p', { text: 'No credit cards yet.' }),
      el('p', { class: 'hint', text: 'Add one on the Credit Cards \u2192 Credit Card tab and its statement can be checked against what you have logged.' }),
    ]));
    return;
  }

  // Attributed by each card's OWN billing cycle, not by calendar month. A card
  // on 5 – 4 puts a swipe on the 2nd onto last month's bill, so matching
  // logged spends to a statement by calendar month compares two different sets
  // of days and can never agree however carefully the spends were entered.
  // Membership is decided by statementYmFor and nothing else. cycleWindow is
  // for SHOWING the period; using it to filter as well meant two functions
  // could disagree, and on a cycle whose days clamp in a short month (a card
  // entered as 31 to 30) a single date could fall inside two windows and be
  // counted on both bills.
  const sumIn = (rows, cardRec, ym2) => round2((rows || [])
    .filter((r) => r.method === 'Card' && r.cardId === cardRec.id
      && mod.statementYmFor(r.date, cardRec) === ym2)
    .reduce((a, r) => a + (Number(r.amount) || 0), 0));

  let anyBilled = false, anyCycle = false;
  cards.forEach((c) => {
    const m = (c.months || []).find((x) => String(x.ym) === ym) || null;
    const billed = m ? round2(Number(m.billed) || 0) : 0;
    if (billed > 0) anyBilled = true;
    const win = mod.cycleWindow(ym, c);
    if (win && win.isCycle) anyCycle = true;
    const house = sumIn(houseRows, c, ym), personal = sumIn(pRows, c, ym);
    const logged = round2(house + personal);
    const gap = round2(billed - logged);
    const pct = billed > 0 ? Math.min(100, (logged / billed) * 100) : 0;
    host.appendChild(el('div', { class: 'pf-card-check' }, [
      el('div', { class: 'pf-cc-top' }, [
        el('span', { class: 'pf-cc-name', text: c.name || 'Card' }),
        el('span', { class: 'pf-cc-billed', text: billed > 0 ? fmtSheetCur(billed) + ' billed' : 'no statement yet' }),
      ]),
      // The window is stated, not implied: it is the whole reason these
      // figures differ from the ones on the Spends tab.
      el('div', { class: 'pf-cc-win' + (win && win.isCycle ? '' : ' is-nocycle'), text: win
        ? (win.isCycle
          ? _spendDayLabel(win.from) + ' – ' + _spendDayLabel(win.to) + ' · cycle ' + win.startDay + '–' + win.endDay
          : _spendDayLabel(win.from) + ' – ' + _spendDayLabel(win.to) + ' · no cycle set on this card')
        : '' }),
      el('div', { class: 'pf-cc-track' }, [
        el('span', { class: 'pf-cc-fill is-house', style: 'width:' + (billed > 0 ? Math.min(100, (house / billed) * 100) : 0).toFixed(1) + '%' }),
        el('span', { class: 'pf-cc-fill is-personal', style: 'width:' + (billed > 0 ? Math.min(100, (personal / billed) * 100) : 0).toFixed(1) + '%' }),
      ]),
      el('div', { class: 'pf-cc-legend' }, [
        el('span', {}, [el('i', { class: 'rvw-dot is-house' }), 'house ' + fmtSheetCur(house)]),
        el('span', {}, [el('i', { class: 'rvw-dot is-personal' }), 'personal ' + fmtSheetCur(personal)]),
      ]),
      billed > 0
        ? el('div', { class: 'pf-cc-gap' + (gap > 0.5 ? ' is-gap' : gap < -0.5 ? ' is-overlogged' : ' is-ok') },
            [gap > 0.5
              ? fmtSheetCur(gap) + ' of this bill is not logged anywhere · ' + Math.round(pct) + '% accounted for'
              : gap < -0.5
                ? fmtSheetCur(-gap) + ' more logged than billed · check for a duplicate, or a spend dated into the wrong month'
                : 'Every rupee of this bill is accounted for'])
        : el('div', { class: 'pf-cc-gap' }, [fmtSheetCur(logged) + ' logged so far this month']),
    ]));
  });

  host.appendChild(explainRow('About this check', anyBilled
    ? 'Each card is read over its OWN billing cycle, shown under its name, and a statement is named for the month it CLOSES in — the month you pay it. So a swipe early in the month is usually on that month\u2019s bill, while one later in it is already on next month\u2019s. That is also why these card figures differ from the Spends tab, which measures a calendar month because the allowance is monthly. Logged is what the two trackers hold for that card in the window: household spends from the Tracker, personal ones from here. Nothing is written back to the card — the statement already contains every swipe, so adding a logged spend to it would count the same one twice. The gap is what was swiped and never written down.'
    : 'Enter the month\u2019s billed figure on a card (Credit Cards \u2192 tap a card \u2192 Months) and this will tell you how much of that bill your two trackers actually explain, read over the card\u2019s own billing cycle.', 'How a card is matched to its bill'));
  if (!anyCycle) {
    host.appendChild(el('p', { class: 'hint warn rvw-note', text: 'None of these cards has a billing cycle set, so each is being read as a calendar month. Add the cycle days on the card (Credit Cards \u2192 tap a card) and the comparison lines up with what the bank actually bills.' }));
  }
}

// Bottom nav for Personal Finance. Spends is where the entries go in; the
// other three read them back - against the limits, as insight, and against the
// card statements the spends turn up on.
export function buildPfBottomNav() {
  const nav = $('#pfBottomNav');
  if (nav.childElementCount) { updatePfNavActive(); return; }
  nav.innerHTML = '';
  [['spends', '\ud83d\uded2', 'Spends'], ['limits', '\ud83c\udfaf', 'Limits'],
   ['review', '\ud83d\udd0d', 'Review'],
   ['tags', '\ud83c\udff7\ufe0f', 'Tags']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (ui._pfTab === v) return; ui._pfTab = v; renderPersonal(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updatePfNavActive();
}
function updatePfNavActive() {
  $('#pfBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._pfTab));
}

// Bottom nav for the Expense section (Credit Card | Allocation | Expense).
// The + FAB only means something on Credit Card (add a card), so it's hidden on
// the other two — same pattern as the Emergency Fund's Funds/Rules tabs.
export function buildExpBottomNav() {
  const nav = $('#expBottomNav');
  if (nav.childElementCount) { updateExpNavActive(); return; }
  nav.innerHTML = '';
  // Tags lives in Personal Finance, not here. It reads BOTH stores and has its
  // own household/personal chooser, so a second copy on this nav was the same
  // page reached two ways - and this nav was the one running out of room.
  // Ordered by how often a tab is actually opened, left to right. Allocation is
  // the annual plan - set once, glanced at - so it sits at the far end next to
  // Review rather than second, where it was taking the easiest reach on the bar
  // from the three tabs touched every week.
  // 'spend' was labelled "Expense" - the same word as the section itself,
  // which read as "which Expense is this" rather than saying what the tab
  // actually is: the monthly cash-flow sheet (In Hand + Virtual Bal minus
  // what's gone out), headlined by Available Balance. Renamed 2026-09-16.
  [['spend', '🧾', 'Cash flow'], ['tracker', '📍', 'Tracker'], ['review', '🔍', 'Review'], ['alloc', '🧭', 'Yearly plan']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (ui._expTab === v) return; ui._expTab = v; renderHomeExpense(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateExpNavActive();
}
export function updateExpNavActive() {
  $('#expBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._expTab));
}

const _FD_MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _fdMonthLabel = (iso) => { const m = /^\d{4}-(\d{2})/.exec(iso || ''); return m ? _FD_MONS[+m[1] - 1] : ''; };

// Whole-rupee currency formatting (no paise) - used for FD interest figures
// (paisa precision doesn't matter, and it makes bank-statement comparisons
// easier to eyeball) and for the Home screen's summary/card figures. Everywhere
// else keeps the normal fmtCur (2 decimals).
const _intCurFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const fmtIntCur = (n) => _intCurFmt.format(Math.round(Number(n) || 0));

export async function renderFD() {
  const host = $('#fdView');
  host.innerHTML = '';
  const mod = await import('./fd.js');
  const fds = (await DB.byIndex('fds', 'owner', 'me')) || [];
  const now = Date.now();
  // resolveChain folds each FD's mapped parent maturity value into its effective
  // deposit (principal = fresh only). One shared cache memoizes the whole tree.
  const fdByIdR = new Map(fds.map((x) => [x.id, x]));
  const rCache = new Map();
  const rows = fds.map((f) => ({ f, c: mod.resolveChain(f, fdByIdR, now, rCache) }));
  updateFdNavActive();

  // No FDs → simple empty state (tabs would be pointless).
  if (!fds.length) {
    host.appendChild(el('section', { class: 'summary' }, [
      el('div', { class: 'label', text: 'Fixed Deposits' }),
      el('div', { class: 'big', text: fmtCur(0, 'INR') }),
    ]));
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🏦' }),
      el('p', { text: 'No fixed deposits yet.' }),
      el('p', { class: 'hint', text: 'Tap + to add your first FD — bank, amount, rate, start & maturity dates.' }),
    ]));
    return;
  }

  // Reinvestment-chain lookups (parentFdIds links) - for card badges + supersede.
  // A new FD can merge several matured FDs, so each parent id maps to the one FD
  // that consumed it.
  const fdByIdAll = new Map(rows.map(({ f }) => [f.id, f]));
  const childByParent = new Map();
  rows.forEach(({ f }) => { mod.parentIdsOf(f).forEach((pid) => childByParent.set(pid, f)); });
  const chainOf = (f) => ({
    parents: mod.parentIdsOf(f).map((pid) => fdByIdAll.get(pid)).filter(Boolean),
    child: childByParent.get(f.id) || null,
  });

  // A matured FD is "superseded" once the FD reinvested from it (its child) has
  // ALSO matured - the newer matured FD then telescopes its principal+interest.
  // Superseded matured FDs are hidden from the holdings list (kept in the data +
  // visible in the Chain tab), so the matured list shows only the latest matured
  // link per chain and can't grow unbounded as the ladder loops. Active FDs are
  // never superseded.
  const supersededIds = new Set();
  rows.forEach(({ f, c }) => { if (c.effectiveStatus === 'matured') mod.parentIdsOf(f).forEach((pid) => supersededIds.add(pid)); });
  const activeRows = rows.filter(({ c }) => c.effectiveStatus === 'active');
  const maturedVisible = rows.filter(({ f, c }) => c.effectiveStatus === 'matured' && !supersededIds.has(f.id));
  const visibleRows = rows.filter(({ f, c }) => c.effectiveStatus === 'active' || !supersededIds.has(f.id));
  let list = ui._fdFilter === 'active' ? activeRows.slice() : ui._fdFilter === 'matured' ? maturedVisible.slice() : visibleRows.slice();

  // Totals over active FDs (the live ladder). With principal = fresh money only,
  // each active FD splits into fresh (out-of-pocket) + rolledIn (recycled from a
  // matured parent); effective principal = fresh + rolledIn.
  let totEff = 0, totFresh = 0, totRolled = 0, totCurVal = 0, totInterest = 0, monthlyIncome = 0;
  activeRows.forEach(({ f, c }) => {
    if (f.emergencyFund) return;  // owned by the Emergency Fund surface
    totEff += c.principal; totFresh += c.freshPrincipal; totRolled += c.rolledIn;
    totCurVal += c.currentValue; totInterest += c.totalInterest; monthlyIncome += c.monthlyIncome;
  });
  const totInv = totEff;   // used by the Overview allocation-by-bank below
  // Simple total return: Interest to earn ÷ effective invested. NOT annualized - a
  // ladder with longer-tenure FDs reads higher here even at the same bank rate,
  // since it's total interest over each FD's own remaining life, not per year.
  const returnPct = totEff > 0 ? (totInterest / totEff) * 100 : 0;
  // Realized interest from matured FDs (non-superseded only - the latest matured
  // link per chain, so recycled money isn't counted twice as the ladder loops).
  let interestMatured = 0;
  maturedVisible.forEach(({ f, c }) => { if (!f.emergencyFund) interestMatured += c.totalInterest; });

  const holdContent = el('div', { class: 'tab-content' + (ui._fdTab === 'holdings' ? '' : ' hidden') });
  const ovrvContent = el('div', { class: 'tab-content' + (ui._fdTab === 'overview' ? '' : ' hidden') });
  const ladderContent = el('div', { class: 'tab-content' + (ui._fdTab === 'ladder' ? '' : ' hidden') });

  // Summary card (shared by Holdings + Overview; hidden on Ladder).
  const summarySec = el('section', { class: 'summary' + (ui._fdTab === 'ladder' ? ' hidden' : '') }, [
    el('div', { class: 'row-between summary-top' }, [
      el('div', {}, [
        el('div', { class: 'label', text: 'Total invested value' }),
        el('div', { class: 'big', text: fmtCur(totEff, 'INR') }),
        el('div', { class: 'fd-subline', text: 'Fresh invested ' + fmtCur(totFresh, 'INR') }),
      ]),
      el('div', { class: 'summary-earned' }, [
        el('div', { class: 'label', text: 'Interest to earn' }),
        el('div', { class: 'v pos', text: fmtIntCur(totInterest) }),
      ]),
    ]),
    el('div', { class: 'grid' }, [
      _mfCell('Reinvested', fmtCur(totRolled, 'INR')),
      _mfCell('Interest matured', fmtIntCur(interestMatured), 'pos'),
      _mfCell('Return %', returnPct ? fmtIntRate(returnPct) : '—'),
      _mfCell('Active FDs', String(activeRows.length)),
    ]),
  ]);

  // ---- Holdings tab: filter + sort + card list ----
  const filterSeg = el('div', { class: 'seg' }, [['active', `Active (${activeRows.length})`], ['matured', `Matured (${maturedVisible.length})`], ['all', `All (${visibleRows.length})`]].map(([v, l]) =>
    el('button', { class: (ui._fdFilter === v ? 'active' : ''), type: 'button', text: l, onclick: () => { ui._fdFilter = v; renderFD(); } })));
  const sortbar = el('div', { class: 'sortbar mf-sortbar' }, [['maturity', 'Maturity'], ['principal', 'Amount'], ['rate', 'Rate']].map(([v, l]) =>
    el('button', { class: 'sort-btn' + (ui._fdSort === v ? ' active' : ''), type: 'button', text: l, onclick: () => { ui._fdSort = v; renderFD(); } })));
  holdContent.appendChild(el('div', { class: 'toolbar mf-toolbar-top' }, [filterSeg, sortbar]));

  if (!list.length) {
    holdContent.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '🏦' }), el('p', { text: 'Nothing here.' })]));
  } else {
    list.sort((a, b2) => {
      if (ui._fdSort === 'principal') return b2.c.principal - a.c.principal;
      if (ui._fdSort === 'rate') return b2.c.rate - a.c.rate;
      if (ui._fdSort === 'bank') return (a.f.bank || '').localeCompare(b2.f.bank || '');
      const am = a.c.maturity ? Date.parse(a.c.maturity) : Infinity;   // maturity: soonest first
      const bm = b2.c.maturity ? Date.parse(b2.c.maturity) : Infinity;
      return am - bm;
    });
    const wrap = el('section', { class: 'stock-list' });
    list.forEach(({ f, c }) => wrap.appendChild(_fdCard(f, c, chainOf(f))));
    holdContent.appendChild(wrap);
  }
  holdContent.appendChild(explainRow('About these FDs', 'Cumulative FDs compound (quarterly by default); payout FDs return principal at maturity with interest paid out along the way. Matured FDs reinvested into a newer FD that has since also matured are hidden here (still in the chain). Not financial advice.', 'How interest is worked out'));

  // ---- Overview tab: allocation by bank + income potential + next maturity ----
  const byBank = {};
  activeRows.forEach(({ f, c }) => { if (f.emergencyFund) return; const k = f.bank || 'Other'; byBank[k] = (byBank[k] || 0) + c.principal; });
  const banks = Object.keys(byBank).sort((a, b2) => byBank[b2] - byBank[a]);
  if (banks.length && totInv > 0) {
    const alloc = el('div', { class: 'chart-card' }, [el('h3', { text: 'Invested by bank' })]);
    banks.forEach((bk) => {
      const pct = (byBank[bk] / totInv) * 100;
      alloc.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: bk }),
        el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: `width:${Math.max(2, pct).toFixed(1)}%` })]),
        el('span', { class: 'bn', text: pct.toFixed(2) + '%' }),
      ]));
    });
    ovrvContent.appendChild(alloc);
  }
  ovrvContent.appendChild(el('div', { class: 'chart-card' }, [
    el('h3', { text: 'Interest income potential' }),
    el('div', { class: 'mf-goal-meta', text: `≈ ${fmtIntCur(monthlyIncome)} / month · ${fmtIntCur(monthlyIncome * 12)} / year` }),
    el('p', { class: 'hint', text: 'Average interest thrown off by your active FDs over their tenure (payout FDs use their actual periodic interest).' }),
  ]));
  const upcoming = activeRows.filter(({ f, c }) => !f.emergencyFund && c.daysToMaturity != null).sort((a, b2) => a.c.daysToMaturity - b2.c.daysToMaturity)[0];
  if (upcoming) {
    ovrvContent.appendChild(el('div', { class: 'chart-card' }, [
      el('h3', { text: 'Next maturity' }),
      el('div', { class: 'mf-goal-meta', text: `${upcoming.f.bank || 'FD'} — ${fmtCur(upcoming.c.maturityValue, 'INR')} on ${upcoming.c.maturity} (${upcoming.c.daysToMaturity} days)` }),
    ]));
  }

  // ---- Ladder tab: ACTIVE FDs only, in upcoming-maturity order ----
  // Matured FDs have already paid out and are done, so they'd just be clutter on
  // a forward-looking "what's coming due" view - the Holdings/Matured filter and
  // Chain tab are where matured history lives.
  const ladderRows = rows.filter(({ f, c }) => !f.emergencyFund && c.maturity && c.effectiveStatus === 'active').sort((a, b2) => Date.parse(a.c.maturity) - Date.parse(b2.c.maturity));
  if (!ladderRows.length) {
    ladderContent.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '🪜' }), el('p', { text: 'No upcoming maturities. Add an active FD with a maturity date to see your ladder.' })]));
  } else {
    ladderContent.appendChild(explainRow('About the ladder', 'Your upcoming maturities, in order — the rungs of the ladder. A gap month means no FD matures then (no interest landing that month), so you can plug it. Tap a rung to edit.', 'How the rungs are read'));
    const wrap = el('div', { class: 'fd-ladder' });
    const mkey = (iso) => (iso || '').slice(0, 7);   // YYYY-MM
    const byMonth = {};
    ladderRows.forEach((r) => { const k = mkey(r.c.maturity); (byMonth[k] = byMonth[k] || []).push(r); });
    const rung = ({ f, c }) => {
      const sub = `${fmtCur(c.principal, 'INR')} @ ${fmtIntRate(c.rate)}` + (c.daysToMaturity >= 0 ? ` · ${c.daysToMaturity}d left` : ' · due');
      return el('div', { class: 'card fd-ladder-row', onclick: () => openFdForm(f) }, [
        el('div', { class: 'fd-ladder-date' }, [
          el('div', { class: 'fd-ladder-mon', text: _fdMonthLabel(c.maturity) }),
          el('div', { class: 'fd-ladder-yr', text: (c.maturity || '').slice(0, 4) }),
        ]),
        el('div', { class: 'fd-ladder-body' }, [
          el('div', { class: 'name', text: f.bank || 'FD' }),
          el('div', { class: 'cat', text: sub }),
        ]),
        // Green badge shows the INTEREST landing at this maturity (the point of the
        // ladder) - the principal is already on the sub-line above.
        el('div', { class: 'fd-ladder-val' }, [el('span', { class: 'mf-value-card positive', text: '+' + fmtIntCur(c.totalInterest) })]),
      ]);
    };
    const gapRung = (k) => el('div', { class: 'card fd-ladder-row fd-ladder-gap' }, [
      el('div', { class: 'fd-ladder-date' }, [
        el('div', { class: 'fd-ladder-mon', text: _FD_MONS[+k.slice(5, 7) - 1] }),
        el('div', { class: 'fd-ladder-yr', text: k.slice(0, 4) }),
      ]),
      el('div', { class: 'fd-ladder-body' }, [
        el('div', { class: 'name', text: 'No maturity' }),
        el('div', { class: 'cat', text: 'No FD maturing this month' }),
      ]),
    ]);
    // Walk every month from the first rung to the last; a month with no maturing
    // FD gets a gap card so the missing interest-landing is visible (the whole
    // point of a ladder is every month having something mature). Guard caps the
    // walk at 600 months so a bad date can't spin forever.
    let [y, m] = mkey(ladderRows[0].c.maturity).split('-').map(Number);
    const [ey, em] = mkey(ladderRows[ladderRows.length - 1].c.maturity).split('-').map(Number);
    let guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (byMonth[k]) byMonth[k].forEach((r) => wrap.appendChild(rung(r)));
      else wrap.appendChild(gapRung(k));
      m++; if (m > 12) { m = 1; y++; }
    }
    ladderContent.appendChild(wrap);
  }

  host.appendChild(summarySec);
  host.appendChild(holdContent);
  host.appendChild(ovrvContent);
  host.appendChild(ladderContent);
}

function _fdCard(f, c, chain) {
  const statusBadge = c.effectiveStatus === 'active'
    ? el('span', { class: 'badge good mf-beat', text: 'active' })
    : el('span', { class: 'badge muted mf-beat', text: 'matured' });
  const catLine = el('div', { class: 'cat mf-catline' }, [`${fmtIntRate(c.rate)} · ${c.comp}` + (c.payout ? ' · payout' : '')]);
  catLine.appendChild(statusBadge);
  if (f.emergencyFund) catLine.appendChild(el('span', { class: 'badge ef-badge mf-beat', text: 'EF' }));
  // A compact blue "reinvested" badge flags an FD funded by rolling in matured
  // FD(s) - replaces the old "↻ from {bank}" text (which wrapped to another line)
  // and the fresh+rolled sub-line. Full breakdown lives in the Chain tab.
  const parents = (chain && chain.parents) || [];
  if (parents.length) catLine.appendChild(el('span', { class: 'badge mf-beat fd-reinvested', text: 'reinvested' }));
  if (chain && chain.child) catLine.appendChild(el('span', { class: 'badge muted mf-beat', text: 'rolled over' }));
  const matTxt = c.maturity
    ? (c.effectiveStatus === 'active'
        ? (c.daysToMaturity >= 0 ? `Matures ${c.maturity} · ${c.daysToMaturity}d` : `Due ${c.maturity}`)
        : `Matured ${c.maturity}`)
    : 'No maturity date';
  return el('div', { class: 'card', onclick: () => openFdForm(f) }, [
    el('div', { class: 'top' }, [
      el('div', { class: 'card-left' }, [
        el('div', { class: 'name', text: f.bank || 'Fixed Deposit' }),
        catLine,
      ]),
      el('div', { class: 'card-right' }, [
        el('div', { class: 'pct pos', text: '+' + fmtIntCur(c.totalInterest) }),
        el('div', { class: 'meta-line', text: 'interest' }),
      ]),
    ]),
    el('div', { class: 'sub mf-sub2' }, [
      el('span', {}, [
        el('div', {}, ['Invested ', b(fmtIntCur(c.principal))]),
        el('div', { class: 'mf-meta-mini', text: matTxt }),
      ]),
      el('span', { class: 'value-emphasis' }, ['Maturity ', _mfValueCard(c.maturityValue, c.principal, false, fmtIntCur)]),
    ]),
  ]);
}

export async function openFdForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const mod = await import('./fd.js');
  const f = Object.assign({ owner: 'me', status: 'active', compounding: 'quarterly', payout: 'cumulative' }, existing || {});

  // Load every FD for the "Funded by" picker + the Chain tab (reinvestment links).
  const allFds = (await DB.byIndex('fds', 'owner', 'me')) || [];
  const nowFd = Date.now();
  const fdById = new Map(allFds.map((x) => [x.id, x]));
  const rCache = new Map();
  const compById = new Map(allFds.map((x) => [x.id, mod.resolveChain(x, fdById, nowFd, rCache)]));
  const childByParent = new Map();   // matured parent id → the FD that merged it in
  allFds.forEach((x) => { mod.parentIdsOf(x).forEach((pid) => childByParent.set(pid, x)); });

  const bankList = el('datalist', { id: 'fdbanklist' }, mod.FD_BANKS.map((x) => el('option', { value: x })));
  const bank = el('input', { type: 'text', value: f.bank || '', list: 'fdbanklist', placeholder: 'Bank / platform' });
  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });
  const principal = numInput(f.principal, 'Fresh ₹ (top-up only)');
  const rate = numInput(f.rate, 'Rate % p.a.');
  const startDate = el('input', { type: 'date', value: f.startDate || todayISO() });
  const maturityDate = el('input', { type: 'date', value: f.maturityDate || '' });
  const tenure = numInput('', 'Months');
  const compounding = el('select', {}, mod.FD_COMPOUNDING.map((x) => { const o = el('option', { value: x, text: x }); if (x === f.compounding) o.selected = true; return o; }));
  const payout = el('select', {}, [['cumulative', 'Cumulative (reinvest)'], ['payout', 'Payout (interest out)']].map(([v, l]) => { const o = el('option', { value: v, text: l }); if (v === f.payout) o.selected = true; return o; }));
  const notes = el('textarea', { placeholder: 'Your notes' });
  notes.value = f.notes || '';

  // Linking an FD to the Emergency Fund hands ownership of it to that surface:
  // it stays listed here with an "EF" badge but leaves this page's totals and
  // Home's Total Invested, so the same money is never counted in two places.
  const efChk = el('input', { type: 'checkbox' });
  efChk.checked = !!f.emergencyFund;
  const efSwitch = el('label', { class: 'switch' }, [
    efChk,
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
  ]);

  // "Funded by" — tick the matured FD(s) whose proceeds seed this one. Multiple
  // can be ticked to MERGE several matured FDs into this single new FD. Only
  // matured FDs not already consumed by another FD are offered (plus any this FD
  // already links). Sorted by maturity date (oldest first). Each parent's payout
  // adds to this FD's effective deposit; the links drive the no-double-count totals.
  const currentParentIds = new Set(mod.parentIdsOf(f));
  const eligibleParents = allFds
    .filter((x) => {
      if (x.id === f.id) return false;                              // never self
      if (compById.get(x.id).effectiveStatus !== 'matured') return false; // only matured can be a source
      const takenBy = childByParent.get(x.id);
      return !(takenBy && takenBy.id !== f.id);                     // not already consumed elsewhere
    })
    .sort((a, b2) => (Date.parse(a.maturityDate || 0) || 0) - (Date.parse(b2.maturityDate || 0) || 0));
  const parentBoxes = [];   // { id, cb }
  const parentListEl = el('div', { class: 'fd-parent-list' });
  if (!eligibleParents.length) {
    parentListEl.appendChild(el('p', { class: 'hint', text: 'No matured FDs available to merge in — this FD is funded by fresh money only.' }));
  } else {
    eligibleParents.forEach((x) => {
      const cb = el('input', { type: 'checkbox' });
      if (currentParentIds.has(x.id)) cb.checked = true;
      parentBoxes.push({ id: x.id, cb });
      const cx = compById.get(x.id);
      parentListEl.appendChild(el('label', { class: 'fd-parent-row' }, [
        cb, el('span', { text: `${x.bank || 'FD'} · ${fmtIntCur(cx.maturityValue)} · matured ${x.maturityDate || ''}` }),
      ]));
    });
  }
  const checkedParentIds = () => parentBoxes.filter((p) => p.cb.checked).map((p) => p.id);

  const buildRec = () => ({
    owner: 'me',
    bank: bank.value.trim(),
    principal: num(principal.value) || 0,   // fresh money only
    rate: num(rate.value) || 0,
    startDate: startDate.value || null,
    maturityDate: maturityDate.value || null,
    compounding: compounding.value,
    payout: payout.value,
    parentFdIds: checkedParentIds(),
    notes: notes.value.trim(),
    emergencyFund: efChk.checked,
    createdAt: f.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed = sum of every ticked matured parent's maturity value (its payout). The
  // new FD's deposit = that + the fresh amount typed here.
  const seedFromParent = () => checkedParentIds().reduce((s, pid) => {
    const pc = compById.get(pid);
    return s + (pc ? pc.maturityValue : 0);
  }, 0);

  const readout = el('div', { class: 'mf-bench-readout' });
  const refresh = () => {
    readout.innerHTML = '';
    const seed = seedFromParent();
    const c = mod.computeFd(buildRec(), Date.now(), seed);
    const rows = [
      el('span', {}, ['Tenure ', b(c.tenureYears ? c.tenureYears.toFixed(2) + ' yr' : '—')]),
      el('span', {}, ['Maturity ', b(c.maturity ? fmtCur(c.maturityValue, 'INR') : '—')]),
      el('span', {}, ['Interest ', b(c.maturity ? fmtIntCur(c.totalInterest) : '—')]),
    ];
    // When money is rolled in from a parent, show the effective deposit breakdown.
    if (seed > 0) rows.unshift(el('span', {}, ['Deposit ', b(fmtCur(c.principal, 'INR')), ` (${fmtCur(c.freshPrincipal, 'INR')} fresh + ${fmtCur(c.rolledIn, 'INR')} rolled)`]));
    readout.appendChild(el('div', { class: 'mf-bench-now' }, rows));
  };
  // Typing a tenure fills the maturity date from the start date; then recompute.
  tenure.addEventListener('input', () => {
    const m = num(tenure.value);
    if (m != null && startDate.value) maturityDate.value = mod.addMonths(startDate.value, m);
    refresh();
  });
  [principal, rate, compounding, payout, startDate, maturityDate].forEach((inp) => inp.addEventListener('input', refresh));
  parentBoxes.forEach((p) => p.cb.addEventListener('change', refresh));
  refresh();

  const del = async () => {
    if (!(await appConfirm('Delete this FD? This cannot be undone.'))) return;
    await DB.del('fds', f.id); closeModal(); toast('FD deleted'); renderFD();
  };
  const save = async () => {
    if (!bank.value.trim()) { toast('Enter the bank / platform'); return; }
    if (!(num(principal.value) > 0)) { toast('Enter the principal amount'); return; }
    const rec = buildRec();
    if (isEdit) rec.id = f.id;
    await DB.put('fds', rec); closeModal(); toast(isEdit ? 'FD updated' : 'FD added'); renderFD();
  };

  // ---- Details tab (the form) ----
  const detailsContent = el('div', {}, [
    field('Bank / platform', bank),
    el('div', { class: 'field-row' }, [field('Fresh principal (top-up only)', principal), field('Rate % p.a.', rate)]),
    el('div', { class: 'field-row' }, [field('Start date', startDate), field('Maturity date', maturityDate)]),
    field('Tenure (months) → fills maturity date', tenure),
    el('div', { class: 'field-row' }, [field('Compounding', compounding, 'compounding'), field('Type', payout, 'payoutType')]),
    moreOptions([
      field('Funded by — tick matured FD(s) to merge in (adds their payout to your deposit)', parentListEl),
      field('Notes', notes),
      field('Part of Emergency Fund — moves it to that page and out of these totals', efSwitch),
    ], !!(existing && ((existing.parentFdIds && existing.parentFdIds.length) || existing.parentFdId || existing.notes || existing.emergencyFund))),
    readout,
  ]);

  // ---- Chain tab: the linked FDs (this FD itself is NOT listed). Walks up via
  // parentFdIds (matured FDs merged in, transitively) and down via childByParent
  // (where this rolled into), deduped, sorted by maturity date. Reflects the LIVE
  // checkbox selection, not just what's saved.
  const chainList = el('div', { class: 'fd-chain' });
  const buildChain = () => {
    const seen = new Set([f.id]);
    const out = [];
    const upStack = checkedParentIds().slice();   // live selection
    let guard = 0;
    while (upStack.length && guard++ < 400) {
      const pid = upStack.shift();
      if (seen.has(pid)) continue;
      const p = fdById.get(pid); if (!p) continue;
      seen.add(pid); out.push(p);
      mod.parentIdsOf(p).forEach((gp) => upStack.push(gp));
    }
    let cur = f; guard = 0;
    while (cur && childByParent.get(cur.id) && guard++ < 400) {
      const ch = childByParent.get(cur.id);
      if (seen.has(ch.id)) break;
      seen.add(ch.id); out.push(ch); cur = ch;
    }
    return out.sort((a, b2) => (Date.parse(a.maturityDate || 0) || 0) - (Date.parse(b2.maturityDate || 0) || 0));
  };
  const renderChain = () => {
    chainList.innerHTML = '';
    const chain = buildChain();
    if (!chain.length) {
      chainList.appendChild(el('p', { class: 'hint', text: 'No linked FDs. Tick a matured FD under “Funded by” on the Details tab to merge it into this one — the linked FDs then show here.' }));
      return;
    }
    chain.forEach((x) => {
      const cx = compById.get(x.id);
      chainList.appendChild(el('div', { class: 'card fd-chain-row', onclick: () => openFdForm(x) }, [
        el('div', { class: 'fd-chain-body' }, [
          el('div', { class: 'name', text: x.bank || 'FD' }),
          el('div', { class: 'cat', text: `${fmtCur(cx.principal, 'INR')} @ ${cx.rate}% · ${cx.effectiveStatus}` + (x.maturityDate ? ` · mat ${x.maturityDate}` : '') }),
        ]),
        el('div', { class: 'fd-chain-int pos', text: '+' + fmtIntCur(cx.totalInterest) }),
      ]));
    });
  };
  const chainContent = el('div', { class: 'hidden' }, [
    el('p', { class: 'hint', text: 'Linked FDs — the matured FD(s) merged into this one (and where it rolls into, if any). Tap a link to open it.' }),
    chainList,
  ]);

  // ---- Tabs (Chain only when editing an existing FD) ----
  const detailsTabBtn = el('button', { class: 'active', type: 'button', text: 'Details' });
  const chainTabBtn = el('button', { type: 'button', text: 'Chain' });
  const tabs = [{ btn: detailsTabBtn, content: detailsContent }];
  if (isEdit) tabs.push({ btn: chainTabBtn, content: chainContent });
  const showTab = (which) => {
    tabs.forEach((t) => { const on = t === which; t.btn.classList.toggle('active', on); t.content.classList.toggle('hidden', !on); });
    if (which.btn === chainTabBtn) renderChain();
  };
  detailsTabBtn.addEventListener('click', () => showTab(tabs[0]));
  if (isEdit) chainTabBtn.addEventListener('click', () => showTab(tabs[1]));

  const scrollChildren = [
    el('h2', { text: isEdit ? (f.bank || 'Edit FD') : 'Add fixed deposit' }),
    el('div', { class: 'seg' }, isEdit ? [detailsTabBtn, chainTabBtn] : [detailsTabBtn]),
    bankList,
    detailsContent,
    ...(isEdit ? [chainContent] : []),
  ];
  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, scrollChildren),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}

// What the Home "Total Invested" / "Total Earned" headline is actually made of.
// Returns one entry per contributing bucket, so the headline figures and the
// ⓘ breakdown sheet are always computed from the same pass and can't drift.
//
// Each exclusion below is deliberate:
//   • Stocks — Me · India (native ₹) + Me · US, converted to ₹ at the Home
//     strip's own live USD→INR rate (2026-09-15 onward - previously Me · US
//     was left out entirely). Wife · India stays excluded regardless: it's a
//     separate book (hers, not this personal total), which is a different
//     reason than the currency and unaffected by adding the US conversion.
//     The US leg silently contributes 0 if no rate has ever been cached (open
//     Home once) rather than guessing one.
//   • Stocks — SGB gold bonds are skipped here and counted under Metals
//     instead (they're gold), so the same money isn't counted twice.
//   • Sold stocks and redeemed funds — that capital is no longer at work.
//   • FDs — MATURED only. Money still locked in a running deposit hasn't come
//     back yet, so it isn't treated as invested capital here; the FD surface
//     tracks the active ladder itself. A matured deposit that was renewed into
//     another matured deposit is superseded by its child, so one principal
//     isn't counted twice along the chain.
//   • Bonds — deliberately a DIFFERENT basis from FDs: invested = ACTIVE bond
//     principal (still-live capital), earned = realised interest from bonds
//     that have closed (matured or sold) only — never an active bond's
//     accrued-but-unpaid interest. Matured/sold principal has been returned,
//     so it's no longer "invested" once it's back; an active bond's principal
//     genuinely still is. See bonds.js computeBond for the realised-interest
//     math (payoutsBeforeExit + soldGain for a sold bond).
//   • Emergency Fund — ANY funds/bonds/fds record flagged `emergencyFund: true`
//     is skipped by its own row above and contributes NOTHING here, not even a
//     row of its own. The Emergency Fund surface is the sole owner of that
//     money: its corpus, its lent-out loans and its idle cash all live there and
//     are deliberately kept out of this pair. Same shape as the SGB rule above
//     (record lives in one store, a different surface counts it) and the same
//     shape as Dividends, which has a Home card and contributes nothing either.
//     DO NOT "fix" this by adding an Emergency Fund row — the parked holdings
//     would then be counted twice, and idle cash plus a family receivable would
//     enter the denominator at 0% and quietly drag the headline return down.
export async function homeInvestedBreakdown() {
  const parts = [];
  let totalInvested = 0, totalValue = 0;
  const add = (label, note, invested, value, count, opts) => {
    // pctBasis overrides what the row's % is computed against - for Bonds,
    // Invested (active principal) and Earned (closed-bond interest) describe
    // DIFFERENT bonds, so interest ÷ active-principal isn't a real return; the
    // matching denominator is the principal that actually earned that interest.
    // badges are EXTRA small pills beside the label, each independently
    // coloured (opts.badges: [{text, cls}]) - Stocks uses two for its India/US
    // holding counts, Metals two for its gold/silver gram totals. `count`
    // stays the plain single-badge case every other row still uses.
    parts.push({
      label, note, invested: invested || 0, value: value || 0, count: count || 0,
      badges: (opts && opts.badges) || [],
      pctBasis: (opts && opts.pctBasis != null) ? opts.pctBasis : null,
    });
    totalInvested += invested || 0;
    totalValue += value || 0;
  };
  // Exclusion counts, surfaced once in the sheet's footer note instead of
  // repeated per-row - each row's own description only says what IS in it.
  const skipped = { sgb: 0, fd: 0, bond: 0, ef: 0 };
  // Only the features the user chose count toward the Home totals.
  const enabled = (id) => modOn(_modsCache, id);
  try {
    // Stocks — Me-India (holdings, not sold; SGB gold bonds excluded, tracked
    // under Metals instead) + Me-US, converted to ₹ at the live USD→INR rate
    // and folded into the SAME row (one combined Invested/Value/% - the money
    // is one "Stocks" total regardless of which market it sits in). The two
    // portfolios' counts stay visible as two badges (count / count2) rather
    // than collapsing into one number.
    const [meInStocks, meUsStocks, liveRatesRow] = await Promise.all([
      DB.byPortfolio('stocks', 'me-in').catch(() => []),
      DB.byPortfolio('stocks', 'me-us').catch(() => []),
      DB.get('meta', 'homeLiveRates').catch(() => null),
    ]);
    const usdInr = liveRatesRow && liveRatesRow.value && liveRatesRow.value.usdInr
      ? Number(liveRatesRow.value.usdInr) : 0;
    let sInv = 0, sVal = 0, sN = 0;
    for (const s of (meInStocks || [])) {
      if (s.status !== 'holding') continue;
      if (isSgb(s)) { skipped.sgb++; continue; }
      sInv += Number(s.units || 0) * Number(s.buyPrice || 0);
      sVal += Number(s.units || 0) * Number(s.currentPrice || 0);
      sN++;
    }
    let usInv = 0, usVal = 0, usN = 0;
    if (usdInr > 0) {
      for (const s of (meUsStocks || [])) {
        if (s.status !== 'holding') continue;
        usInv += Number(s.units || 0) * Number(s.buyPrice || 0) * usdInr;
        usVal += Number(s.units || 0) * Number(s.currentPrice || 0) * usdInr;
        usN++;
      }
    }
    if (enabled('stocks')) add('Stocks', 'Me · India' + (usN ? ' + Me · US, converted to ₹' : ' holdings'), sInv + usInv, sVal + usVal, 0, {
      badges: [
        sN ? { text: String(sN), title: 'Me · India' } : null,
        usN ? { text: String(usN), cls: 'brk-count-us', title: 'Me · US' } : null,
      ].filter(Boolean),
    });

    // Mutual Funds — Investing only (exclude Sold)
    const funds = await DB.byIndex('funds', 'owner', 'me') || [];
    let fInv = 0, fVal = 0, fN = 0;
    for (const f of funds) {
      if (f.status === 'Sold' || f.soldDate) continue;
      // Linked to the Emergency Fund — that surface owns it, same as SGBs above
      // belong to Metals rather than Stocks.
      if (f.emergencyFund) { skipped.ef++; continue; }
      const c = await import('./mf.js').then(mod => mod.computeFund(f, Date.now())).catch(() => null);
      if (c) { fInv += c.invested || 0; fVal += c.value || 0; fN++; }
    }
    if (enabled('mf')) add('Mutual Funds', 'Active SIPs & lumpsums', fInv, fVal, fN);

    // Fixed Deposits — MATURED, but NOT superseded by a matured child
    const fds = (await DB.byIndex('fds', 'owner', 'me')) || [];
    let dInv = 0, dVal = 0, dN = 0;
    if (fds.length) {
      const fdMod = await import('./fd.js');
      const nowT = Date.now();
      const fdByIdH = new Map(fds.map((x) => [x.id, x]));
      const fdCacheH = new Map();
      const fdComp = new Map(fds.map((x) => [x.id, fdMod.resolveChain(x, fdByIdH, nowT, fdCacheH)]));
      const supersededIds = new Set();
      fds.forEach((x) => {
        if (fdComp.get(x.id).effectiveStatus === 'matured') fdMod.parentIdsOf(x).forEach((pid) => supersededIds.add(pid));
      });
      for (const fdRec of fds) {
        const c = fdComp.get(fdRec.id);
        if (fdRec.emergencyFund) { skipped.ef++; continue; }   // owned by the Emergency Fund surface
        if (c.effectiveStatus !== 'matured') { skipped.fd++; continue; }
        if (supersededIds.has(fdRec.id)) { skipped.fd++; continue; }
        dInv += c.principal; dVal += c.maturityValue; dN++;
      }
    }
    if (enabled('fd')) add('Fixed Deposits', 'Matured deposits', dInv, dVal, dN);

    // Metals — gold + silver (at current market prices)
    const metalData = await metalPortfolio();
    const mInv = (metalData.gold.invested || 0) + (metalData.silver.invested || 0);
    const mVal = (metalData.gold.value || 0) + (metalData.silver.value || 0);
    if (enabled('metal')) add('Metals', 'Digital gold & silver' + (metalData.gold.sgbCount ? ' + SGB (as gold)' : ''), mInv, mVal, 0, {
      badges: [
        metalData.gold.grams ? { text: _gramsShort(metalData.gold.grams) + 'g', cls: 'brk-count-gold', title: 'Gold' } : null,
        metalData.silver.grams ? { text: _gramsShort(metalData.silver.grams) + 'g', cls: 'brk-count-silver', title: 'Silver' } : null,
      ].filter(Boolean),
    });

    // Bonds — active principal as invested; realised interest from closed
    // (matured + sold) bonds as earned. Opposite basis from FDs above, on
    // purpose (see the header comment). `bVal` here is NOT "current value" of
    // the bonds - it's invested + realised interest, so that value − invested
    // reduces to exactly the realised-interest figure this row is meant to show.
    const bonds = (await DB.byIndex('bonds', 'owner', 'me')) || [];
    let bInv = 0, bVal = 0, bN = 0, bMaturedPrincipal = 0;
    if (bonds.length) {
      const bondMod = await import('./bonds.js');
      const nowB = Date.now();
      bonds.forEach((bRec) => {
        const c = bondMod.computeBond(bRec, nowB);
        // Linked to the Emergency Fund — that surface owns it, so it must not
        // land in either side of this row (not even its realised interest).
        if (bRec.emergencyFund) { skipped.ef++; return; }
        // outstandingPrincipal, not principal: an amortizing bond has already
        // handed part of its capital back, and that money is no longer invested
        // here. Identical to principal for every non-amortizing active bond.
        if (c.effectiveStatus === 'active') { bInv += c.outstandingPrincipal; bVal += c.outstandingPrincipal; bN++; }
        else { bVal += c.interestEarned; bMaturedPrincipal += c.principal; skipped.bond++; }
      });
    }
    // pctBasis: this row's Invested (active bonds) and Earned (closed bonds'
    // interest) describe DIFFERENT bonds, so interest ÷ active-principal isn't
    // a real return. The matching denominator is the principal of the closed
    // bonds that actually earned that interest.
    if (enabled('bond')) add('Bonds', 'Active principal + realised interest', bInv, bVal, bN, { pctBasis: bMaturedPrincipal });
  } catch (_) {}
  if (!enabled('stocks')) skipped.sgb = 0;
  if (!enabled('fd')) skipped.fd = 0;
  if (!enabled('bond')) skipped.bond = 0;
  return { parts, totalInvested, totalValue, skipped };
}

// ⓘ sheet behind the Home headline — shows exactly which buckets make up the
// Total Invested figure, and what is deliberately left out of it.
export function openInvestedBreakdown(bd) {
  // `basis` defaults to the row's own Invested figure, but a row can override
  // it (pctBasis) with a different denominator - Bonds' Invested is active
  // principal while Earned is closed-bond interest, so the % has to be
  // computed against the closed bonds' OWN principal to mean anything.
  const pctRow = (basis, earned) => {
    if (!(basis > 0)) return el('span', { class: 'brk-pct muted', text: '—' });
    const pct = (earned / basis) * 100;
    return el('span', { class: 'brk-pct ' + pctClass(pct), text: fmtPct(pct) });
  };
  // Each source's share of Total Invested - answers "where is the money
  // actually sitting", which the rupee figures alone make you compute in your
  // head. One decimal throughout so a small sliver (0.4%) never rounds away to
  // a meaningless 0%.
  const allocPct = (invested) => {
    if (!(bd.totalInvested > 0)) return '—';
    return ((invested / bd.totalInvested) * 100).toFixed(1) + '%';
  };
  const rows = bd.parts.map((p) => {
    const earned = p.value - p.invested;
    return el('div', { class: 'brk-row' }, [
      el('div', { class: 'brk-main' }, [
        el('div', { class: 'brk-name' }, [
          p.label,
          p.count ? el('span', { class: 'brk-count', text: String(p.count) }) : null,
          ...p.badges.map((b) => el('span', { class: 'brk-count ' + (b.cls || ''), title: b.title || '', text: b.text })),
        ].filter(Boolean)),
        el('div', { class: 'brk-note', text: p.note }),
      ]),
      el('div', { class: 'brk-nums' }, [
        el('div', { class: 'brk-inv' }, [
          fmtIntCur(p.invested),
          el('span', { class: 'brk-alloc', text: allocPct(p.invested) }),
        ]),
        el('div', { class: 'brk-earn ' + pctClass(earned) }, [
          (earned >= 0 ? '+' : '') + fmtIntCur(earned) + ' ', pctRow(p.pctBasis != null ? p.pctBasis : p.invested, earned),
        ]),
      ]),
    ]);
  });
  const totalEarned = bd.totalValue - bd.totalInvested;
  // Exclusions are stated ONCE here, with real counts when there are any to
  // report - each row above only describes what it includes.
  const sk = bd.skipped || {};
  const skipBits = [];
  if (sk.sgb) skipBits.push(sk.sgb + ' SGB' + (sk.sgb > 1 ? 's' : '') + ' (counted under Metals instead)');
  if (sk.fd) skipBits.push(sk.fd + ' FD' + (sk.fd > 1 ? 's' : '') + ' still running or renewed');
  if (sk.bond) skipBits.push(sk.bond + ' matured/sold bond' + (sk.bond > 1 ? 's' : '') + ' whose principal has been returned');
  if (sk.ef) skipBits.push(sk.ef + ' holding' + (sk.ef > 1 ? 's' : '') + ' linked to the Emergency Fund (tracked on its own page)');
  const footNote = 'Not counted: Wife · India stocks (a separate book), sold stocks and redeemed funds' +
    (skipBits.length ? ', ' + skipBits.join(', ') : '') +
    ' - that money is either tracked elsewhere, still locked in, or already back in hand.';
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'What makes up Total Invested' }),
    el('div', { class: 'brk-head' }, [
      el('span', { text: 'Source' }),
      el('span', { text: 'Invested · Share · Earned · Return' }),
    ]),
    el('div', { class: 'brk-list' }, rows),
    el('div', { class: 'brk-row brk-total' }, [
      el('div', { class: 'brk-main' }, [el('div', { class: 'brk-name', text: 'Total' })]),
      el('div', { class: 'brk-nums' }, [
        el('div', { class: 'brk-inv' }, [
          fmtIntCur(bd.totalInvested),
          el('span', { class: 'brk-alloc', text: bd.totalInvested > 0 ? '100.0%' : '—' }),
        ]),
        el('div', { class: 'brk-earn ' + pctClass(totalEarned) }, [
          (totalEarned >= 0 ? '+' : '') + fmtIntCur(totalEarned) + ' ', pctRow(bd.totalInvested, totalEarned),
        ]),
      ]),
    ]),
    el('p', { class: 'hint', text: footNote }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

// How far ahead Home's "Coming up this week" strip looks. One week: near enough
// that the money needs a decision now, far enough ahead to actually act on it.
const UPCOMING_DAYS = 7;
// The live resize handler for Home's "Coming Up" strip, so a re-render can
// detach the previous one (see _homeUpcomingStrip).
let _upcomingResizeHandler = null;

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
  const paid = document.body.dataset.plan === 'paid';
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
  if (document.body.dataset.plan !== 'paid') {
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
  host.appendChild(el('div', { class: 'home-hero' }, [
    el('div', { class: 'home-hero-left' }, [
      el('img', { class: 'home-title-ico' + (document.body.dataset.plan === 'paid' ? ' is-pro' : ''), src: document.body.dataset.plan === 'paid' ? 'icons/icon-pro.png' : 'icons/icon-free.png', alt: '' }),
      el('div', { class: 'home-hero-text' }, [
        el('h2', { class: 'home-title' + (document.body.dataset.plan === 'paid' ? ' has-pro' : '') }, [
          document.createTextNode('MyNotes'),
          ...(document.body.dataset.plan === 'paid'
            ? [el('span', { class: 'pro-pill', title: 'Pro Plan member' }, [el('img', { class: 'pro-pill-star', src: 'icons/emoji/pro-star.png', alt: '' }), document.createTextNode('PRO')])]
            : []),
        ]),
        _hName
          ? el('button', { class: 'home-tag home-tag-name', type: 'button', title: 'Tap to change your name', text: '👋 ' + greetingFor(_hName, _hNow), onclick: openNameEditor })
          : el('p', { class: 'home-tag', text: '🔒 Your data never leaves this device' }),
      ]),
    ]),
    el('div', { class: 'home-hero-right' }, [
      // The app's own month names, not the locale's - en-GB renders September
      // as "Sept" while every other surface here says "Sep".
      el('div', { class: 'home-today',
        text: _hNow.getDate() + ' ' + _FD_MONS[_hNow.getMonth()] }),
      // Days you can still spend on, today included - the same count every
      // per-day figure in the app divides by, so the two always reconcile.
      el('div', { class: 'home-days' + (_hDays <= 5 ? ' is-tight' : ''), title: perDayLabel(_hDays),
        text: _hDays + (_hDays === 1 ? ' day left' : ' days left') }),
      // Anything that is not production says so, so a test copy is never mistaken for the real app.
      el('div', { class: 'home-ver', text: 'v' + APP_VERSION + (IS_PRODUCTION ? '' : ' \u00b7 ' + ENV) }),
    ]),
  ]));

  // A term running out outranks even Get Started - it is time-sensitive in a way nothing else on Home is.
  try { const rc = _homeRenewalCard(); if (rc) host.appendChild(rc); _enterRenewalCard(rc); } catch (_) {}
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
    _subFor([['ef', 'Emergency Fund'], ['div', 'Dividends'], ['banksav', 'Bank Savings'], ['inflation', 'Inflation']]),
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
  const expenseCard = _homeCard('🛒', 'Expense', 'Cash flow · Tracker · Review', () => setAppMode('expense'));
  expenseCard.querySelector('.home-card-ico').addEventListener('click', (e) => {
    e.stopPropagation();
    ui._expTab = 'spend';
    setAppMode('expense');
  });
  const ccCard = _homeCard('💳', 'Credit Cards', 'Cards · Heatmap · Category spend · Card check', () => setAppMode('cc'));
  const personalCard = _homeCard(_walletIcon(), 'Personal Finance', 'Own spends · card & UPI / cash limits', () => setAppMode('personal'));
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
    _on('ef', 'div', 'banksav', 'inflation') ? savingsCard : null,
    _on('health') ? healthCard : null,
    _on('vault') ? vaultCard : null,
  ].filter(Boolean);
  host.appendChild(el('div', { class: 'home-cards' }, _homeCards));

  // Wrapped like the upcoming strip above - three boxes hitting two external
  // APIs must never be the reason Home fails to render.
  try {
    const live = await _homeLiveRatesStrip();
    if (!stale()) host.appendChild(live);
  } catch (_) {}
  if (stale()) return;

  const caution = await _homeBackupCaution();
  if (stale()) return;
  host.appendChild(caution);

  // Per-day room on the two cards that have a budget behind them. Wrapped, and
  // last, for the same reason the investment stats are: a failure reading one
  // of these must leave Home standing rather than blank it.
  try {
    const thisYm = todayISO().slice(0, 7);
    const daysLeft = _spendableDaysLeft(thisYm);

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

    const pf = await pfLoad();
    const t = pfTotals(thisYm, pf.byYm, pf.allocs, pf.upiLimit);
    if (t.limit > 0) _perDayBadge(personalCard.querySelector('.home-card-badge'), t.left, daysLeft);
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
async function _homeUpcomingStrip() {
  // Coming Up is a Pro Plan feature. The reminders themselves (FD and bond dates, dividends, SIPs) still
  // live on their own screens for everybody; this is the strip that gathers them on Home.
  if (document.body.dataset.plan !== 'paid') return null;
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

  // Reminders only for the features the user chose.
  const _kindModule = { FD: 'fd', BOND: 'bond', DIV: 'div', SIP: 'mf' };
  for (let i = items.length - 1; i >= 0; i--) {
    if (!modOn(_modsCache, _kindModule[items[i].kind])) items.splice(i, 1);
  }
  if (!items.length) return null;
  items.sort((a, b2) => a.days - b2.days);

  const strip = el('div', { class: 'due-soon' });
  strip.appendChild(el('div', { class: 'due-soon-head' }, [
    el('span', { class: 'due-soon-title', text: '\u23f0 Coming Up' }),
    el('span', { class: 'due-soon-count', text: items.length + (items.length === 1 ? ' item' : ' items') }),
  ]));
  // Built as a factory, not built once and cloned: the marquee below needs a
  // second identical group to loop seamlessly, and cloneNode() would drop every
  // onclick — giving a rail of dead cards for half its travel.
  const buildGroup = () => {
  const rail = el('div', { class: 'due-soon-group' });
  items.forEach((it) => {
    // Dividend reminder: no due date to count down to (it covers the whole
    // month), so it gets its own two rows - the badge alone (top-right, same
    // corner every other badge lives in) over the comma-separated stock names.
    if (it.kind === 'DIV') {
      rail.appendChild(el('button', { class: 'due-soon-card is-div', type: 'button', onclick: it.go }, [
        el('div', { class: 'due-soon-row' }, [
          el('span', { class: 'due-soon-days', text: '\ud83d\udcb0' }),
          el('span', { class: 'badge mf-beat due-badge-div', text: it.monthLabel }),
        ]),
        el('div', { class: 'due-soon-row' }, [
          el('span', { class: 'due-soon-names', text: it.names.join(', ') }),
        ]),
      ]));
      return;
    }
    const d = it.days;
    // An FD maturing today is already 'matured' per fd.js so it never reaches
    // here, but a bond payout dated today legitimately can - hence the Today case.
    const dayTxt = it.kind === 'SIP'
      ? (d <= 0 ? 'SIP today' : d === 1 ? 'SIP tomorrow' : 'SIP in ' + d + ' days')
      : (d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : d + ' Days left');
    // Anything inside 2 days is worth the warning colour; the rest is just info.
    const urgent = d <= 2;
    // Two fixed rows - type/EF badge top-right beside "days left", maturity
    // date bottom-right beside the amount - rather than letting the card grow
    // TALLER as more badges/text show up. If a row's content needs more room,
    // the card grows WIDER instead (see .due-soon-card white-space: nowrap).
    rail.appendChild(el('button', { class: 'due-soon-card' + (urgent ? ' is-urgent' : ''), type: 'button', onclick: it.go }, [
      el('div', { class: 'due-soon-row' }, [
        el('span', { class: 'due-soon-days', text: dayTxt }),
        el('span', { class: 'due-soon-badges' }, [
          el('span', { class: 'badge mf-beat due-badge-' + it.kind.toLowerCase(), text: it.kind }),
          it.ef ? el('span', { class: 'badge ef-badge mf-beat', text: 'EF' }) : document.createTextNode(''),
        ]),
      ]),
      el('div', { class: 'due-soon-row' }, [
        el('span', { class: 'due-soon-amt', text: fmtIntCur(it.amount) }),
        // A SIP card names the fund instead of a date (the day is already in the top line), cut short so the card
        // stays the size of a Bond card.
        el('span', { class: 'due-soon-date', title: it.kind === 'SIP' ? it.name + ' \u00b7 ' + _shortDayMon(it.date) : '',
          text: it.kind === 'SIP' ? (it.name.length > 18 ? it.name.slice(0, 17) + '\u2026' : it.name) : _shortDayMon(it.date) }),
      ]),
    ]));
  });
  return rail;
  };

  const track = el('div', { class: 'due-soon-rail' }, [buildGroup()]);

  // The rail scrolls by hand when it overflows, but with only two or three cards
  // on screen there's nothing telling you more exist off to the right. A fade on
  // the trailing edge is that cue - shown only while it genuinely overflows, and
  // cleared once you reach the end so it never implies content that isn't there.
  const scroller = el('div', { class: 'due-soon-scroller' }, [track]);
  const syncFade = () => {
    if (scroller.classList.contains('is-marquee')) return; // marquee: no manual scroll to hint at
    const max = track.scrollWidth - track.clientWidth;
    scroller.classList.toggle('can-scroll', max > 2);
    scroller.classList.toggle('at-end', max > 2 && track.scrollLeft >= max - 2);
  };
  track.addEventListener('scroll', syncFade, { passive: true });

  // Touch has no hover, so a finger on the strip pauses it the same way a
  // pointer does — otherwise the card you're reaching for slides away. Released
  // on a short delay so a tap doesn't restart the motion before it registers.
  let holdTimer = null;
  const hold = () => { clearTimeout(holdTimer); scroller.classList.add('is-held'); };
  const release = () => {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => scroller.classList.remove('is-held'), 600);
  };
  scroller.addEventListener('touchstart', hold, { passive: true });
  scroller.addEventListener('touchend', release, { passive: true });
  scroller.addEventListener('touchcancel', release, { passive: true });

  // ---- Drift ----
  // Once the cards overflow, the strip runs on its own. Put a finger (or the mouse) on it and it STOPS; drag or
  // scroll it at whatever speed you like, like a timeline; let go and it carries on from where you left it.
  // The rail is a real scroll container, and the drift is a small loop that nudges scrollLeft, so native touch
  // scrolling and momentum work as they do anywhere else.
  //
  // It glides to the last card, rests, glides back and rests again. It used to loop by putting a second copy
  // of every card after the first, which read as each card being shown twice; a back-and-forth needs no copy,
  // so every card is on screen exactly once.
  const DRIFT_PX_PER_SEC = 34, DRIFT_BACK_PX_PER_SEC = 140, DRIFT_REST_MS = 1600;
  let driftRaf = null, driftLast = 0, driftPos = 0, driftPause = false, driftHold = false, driftTimer = null, dragDist = 0;
  let driftDir = 1, driftRestUntil = 0;
  const driftResume = () => {
    clearTimeout(driftTimer);
    // A short quiet spell after the last touch or scroll, so a fling can finish before the drift takes over again.
    driftTimer = setTimeout(() => { if (driftHold) return; driftPause = false; driftPos = track.scrollLeft; driftLast = 0; }, 450);
  };
  const driftStop = () => { clearTimeout(driftTimer); driftPause = true; };
  const driftTick = (t) => {
    if (!scroller.isConnected) { driftRaf = null; return; }   // Home was redrawn: this strip is gone
    const dt = driftLast ? Math.min(64, t - driftLast) : 0;
    driftLast = t;
    if (!driftPause && t >= driftRestUntil) {
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      driftPos += driftDir * (driftDir > 0 ? DRIFT_PX_PER_SEC : DRIFT_BACK_PX_PER_SEC) * dt / 1000;
      if (driftPos >= max) { driftPos = max; driftDir = -1; driftRestUntil = t + DRIFT_REST_MS; }
      else if (driftPos <= 0) { driftPos = 0; driftDir = 1; driftRestUntil = t + DRIFT_REST_MS; }
      track.scrollLeft = driftPos;
    }
    driftRaf = requestAnimationFrame(driftTick);
  };
  const startDrift = () => {
    if (driftRaf != null) return;
    scroller.classList.add('is-drifting');
    // Start at the first card, resting there for a moment so it can be read before anything moves.
    track.scrollLeft = 0;
    driftPos = 0; driftDir = 1; driftRestUntil = performance.now() + DRIFT_REST_MS;
    driftLast = 0; driftPause = false;
    driftRaf = requestAnimationFrame(driftTick);
  };
  const stopDrift = () => { if (driftRaf != null) cancelAnimationFrame(driftRaf); driftRaf = null; clearTimeout(driftTimer); scroller.classList.remove('is-drifting'); track.scrollLeft = 0; };

  // Touch: native scrolling; hold stops the drift, release lets it carry on after the fling settles.
  track.addEventListener('touchstart', () => { driftHold = true; driftStop(); }, { passive: true });
  track.addEventListener('touchend', () => { driftHold = false; driftResume(); }, { passive: true });
  track.addEventListener('touchcancel', () => { driftHold = false; driftResume(); }, { passive: true });
  // Mouse: drag to scroll, hover to pause (a card can be read and clicked), leave to carry on.
  let mouseDrag = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouseDrag = { x: e.clientX, left: track.scrollLeft }; dragDist = 0; driftHold = true; driftStop();
    try { track.setPointerCapture(e.pointerId); } catch (_) {}
  });
  track.addEventListener('pointermove', (e) => {
    if (!mouseDrag) return;
    const dx = e.clientX - mouseDrag.x;
    dragDist = Math.max(dragDist, Math.abs(dx));
    track.scrollLeft = mouseDrag.left - dx;
  });
  const endMouse = () => { if (!mouseDrag) return; mouseDrag = null; driftHold = false; driftResume(); };
  track.addEventListener('pointerup', endMouse);
  track.addEventListener('pointercancel', endMouse);
  track.addEventListener('mouseenter', () => { driftStop(); });
  track.addEventListener('mouseleave', () => { if (!mouseDrag) { driftHold = false; driftResume(); } });
  // A drag must not count as a tap on the card under the pointer.
  track.addEventListener('click', (e) => { if (dragDist > 5) { e.preventDefault(); e.stopPropagation(); dragDist = 0; } }, true);
  // Scrolling by wheel, trackpad or keyboard focus also holds the drift while it happens.
  track.addEventListener('wheel', () => { driftStop(); driftResume(); }, { passive: true });
  track.addEventListener('focusin', driftStop);
  track.addEventListener('focusout', () => { driftHold = false; driftResume(); });
  // Any scroll while paused is the person's own: follow it, and resume once it goes quiet.
  track.addEventListener('scroll', () => {
    if (!driftPause) return;
    driftPos = track.scrollLeft;   // the person's own scroll is a plain timeline that stops at the ends
    if (!driftHold) driftResume();
  }, { passive: true });

  // Once there are more cards than fit, hand-scrolling is a poor fit for a
  // glanceable strip - you'd have to know to swipe. Past that point it becomes a
  // marquee instead: a second identical group is appended and the track slides
  // exactly one group's width, so the loop is seamless (the clone lands where
  // the original started). Below the overflow threshold nothing animates, since
  // there'd be nothing to reveal.
  const setupRail = () => {
    const groups = track.querySelectorAll('.due-soon-group');
    const first = groups[0];
    if (!first) return;
    const overflows = first.scrollWidth > scroller.clientWidth + 2;
    // A copy left over from an older build of this strip would show every card twice.
    if (groups[1]) groups[1].remove();
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!overflows || reduceMotion) {
      // Drop back to the plain scroll+fade rail (also the path when the strip
      // shrinks on resize, or a card is logged and the rest now fit).
      stopDrift();
      scroller.classList.remove('is-marquee');
      track.style.removeProperty('--marquee-duration');
      syncFade();
      return;
    }

    scroller.classList.add('is-marquee');
    scroller.classList.remove('can-scroll', 'at-end');
    // Constant speed however many cards there are, so adding one makes the glide longer rather than faster.
    startDrift();
  };
  // Deferred via setTimeout, not requestAnimationFrame: the rail isn't attached
  // to the document yet (renderHome() appends the returned strip right after
  // this call returns), and rAF is suspended entirely on a backgrounded tab
  // (e.g. the phone screen just locked) - a plain macrotask still fires either
  // way, and reading clientWidth/scrollWidth forces the layout it needs.
  setTimeout(setupRail, 0);
  // Rotating the phone can flip the strip either way across the threshold.
  // Home re-renders on every visit back, so drop the previous strip's handler
  // first — otherwise each visit leaves another one behind, all firing against
  // the detached rails of strips that no longer exist.
  if (_upcomingResizeHandler) window.removeEventListener('resize', _upcomingResizeHandler);
  _upcomingResizeHandler = debounce(setupRail, 150);
  window.addEventListener('resize', _upcomingResizeHandler);

  strip.appendChild(scroller);
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
export async function refreshHomeFabRings() {
  const kittyBtn = $('#spendAddBtn'), pfBtn = $('#pfAddBtn');
  if (document.body.dataset.plan !== 'paid') { _clearFabRing(kittyBtn); _clearFabRing(pfBtn); return; }
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
