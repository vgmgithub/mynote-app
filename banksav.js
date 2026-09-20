import { DB } from './db.js';
import { fmtCur, todayISO, num } from './core.js';
import { $, el, _mfCell, fmtIntCur, explainRow, appConfirm, closeModal, toast, openModal, field } from './app.js';

// ---------- Bank Savings surface ----------
// Deliberately the simplest surface in the app: one flat list of savings
// accounts, each holding its CURRENT balance (typed in by hand — there's no
// bank API to fetch it live) plus the date that balance was last checked. No
// bottom nav, no sub-tabs, no derived interest math — just note it down, and
// a clean way to add/edit/remove an account. Single view; no bind() needed
// beyond the FAB.
const BANK_SAV_BANKS = ['SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'IDFC FIRST Bank', 'IndusInd Bank'];

export async function renderBankSavings() {
  const host = $('#bankSavView');
  host.innerHTML = '';
  const rows = (await DB.all('bankSavings')) || [];

  if (!rows.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🐷' }),
      el('p', { text: 'No savings accounts logged yet.' }),
      el('p', { class: 'hint', text: 'Tap + to note down a bank and its current balance.' }),
    ]));
    return;
  }

  const total = rows.reduce((s, r) => s + (Number(r.balance) || 0), 0);
  host.appendChild(el('section', { class: 'summary' }, [
    el('div', { class: 'label', text: 'Total across banks' }),
    el('div', { class: 'big', text: fmtCur(total, 'INR') }),
    el('div', { class: 'grid' }, [
      _mfCell('Accounts', String(rows.length)),
      _mfCell('Average', fmtIntCur(rows.length ? total / rows.length : 0)),
    ]),
  ]));

  const list = el('section', { class: 'stock-list' });
  rows.slice().sort((a, b2) => (Number(b2.balance) || 0) - (Number(a.balance) || 0)).forEach((r) => {
    const asOf = r.asOfDate ? 'as of ' + r.asOfDate : 'no date logged';
    list.appendChild(el('div', { class: 'card', onclick: () => openBankSavForm(r) }, [
      el('div', { class: 'top' }, [
        el('div', { class: 'card-left' }, [
          el('div', { class: 'name', text: r.bank || 'Bank' }),
          el('div', { class: 'cat mf-catline', text: (r.label ? r.label + ' · ' : '') + asOf }),
        ]),
        el('div', { class: 'card-right' }, [el('div', { class: 'pct', text: fmtIntCur(r.balance) })]),
      ]),
    ]));
  });
  host.appendChild(list);
  host.appendChild(explainRow('About these balances', 'Balances are typed in by hand, not fetched live — update one whenever you check it. Not counted in Home\'s Total Invested (it\'s cash in hand, not capital at work).', 'Where these come from'));
}

// What kind of account it is (shown under the bank name). Optional.
const BANK_SAV_TYPES = ['Savings', 'Salary', 'Joint', 'Current', 'NRE / NRO', 'Business', 'Kids / Minor', 'Other'];

export async function openBankSavForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const r = Object.assign({}, existing || {});

  const bankList = el('datalist', { id: 'banksavbanklist' }, BANK_SAV_BANKS.map((x) => el('option', { value: x })));
  const bank = el('input', { type: 'text', value: r.bank || '', list: 'banksavbanklist', placeholder: 'Bank name' });
  // Account type: a fixed list instead of free text. An older account whose text is not on the list keeps its own
  // value as an option, so nothing already saved is lost or silently changed. Stored in the same `label` field.
  const types = r.label && !BANK_SAV_TYPES.includes(r.label) ? BANK_SAV_TYPES.concat([r.label]) : BANK_SAV_TYPES;
  const label = el('select', { 'aria-label': 'Account type' }, [el('option', { value: '', text: 'Select account type' })]
    .concat(types.map((t) => el('option', { value: t, text: t }))));
  label.value = r.label || '';
  const balance = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: r.balance != null ? r.balance : '', placeholder: '₹ current balance' });
  const asOfDate = el('input', { type: 'date', value: r.asOfDate || todayISO() });
  const notes = el('textarea', { placeholder: 'Your notes' });
  notes.value = r.notes || '';

  const buildRec = () => ({
    bank: bank.value.trim(),
    label: label.value,
    balance: num(balance.value) || 0,
    asOfDate: asOfDate.value || todayISO(),
    notes: notes.value.trim(),
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const del = async () => {
    if (!(await appConfirm('Delete this savings account? This cannot be undone.'))) return;
    await DB.del('bankSavings', r.id); closeModal(); toast('Account deleted'); renderBankSavings();
  };
  const save = async () => {
    if (!bank.value.trim()) { toast('Enter the bank name'); return; }
    if (num(balance.value) == null) { toast('Enter the current balance'); return; }
    const rec = buildRec();
    if (isEdit) rec.id = r.id;
    await DB.put('bankSavings', rec); closeModal(); toast(isEdit ? 'Account updated' : 'Account added'); renderBankSavings();
  };

  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: isEdit ? (r.bank || 'Edit account') : 'Add savings account' }),
      bankList,
      field('Bank', bank),
      field('Account type', label),
      field('Current balance (₹)', balance),
      field('As of date', asOfDate),
      field('Notes', notes),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}
