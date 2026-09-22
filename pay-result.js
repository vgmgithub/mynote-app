// The pages shown after a payment, and the record of it kept on the device.
//
//   Success      a welcome, the transaction id, what is unlocked, and a countdown into the guided plan setup.
//   Failure      what went wrong in plain words (chosen by the code Razorpay returned), with Try again or Cancel.
//   Unconfirmed  the payment went through but our server has not switched Pro on yet: money may have moved, so this
//                one says so, gives the reference, and offers Check again.
//
// Every attempt is saved (success or failure) in `meta` under 'payments', newest first, so it can be reopened from the
// Menu. That is additive settings data: no schema change, and it is not part of a backup file.
//
// Each page is a full-screen layer added to <body>. "Save receipt" does not print it: it draws a proper receipt on a
// canvas (pay-invoice.js) and shares it as a PNG, so what leaves the app looks the same on every phone.
import { DB } from './db.js';
import { el, toast, getUserName, getAlias, APP_MODULES } from './app.js';
import { failureInfo, formatRupees, addTransaction, receiptText, STATUS_LABEL, PERIOD_LABEL, refIdLabel } from './pay-core.js';

const KEY = 'payments';

// ---------- the saved record ----------
export async function loadTransactions() {
  const r = await DB.get('meta', KEY).catch(() => null);
  return r && Array.isArray(r.value) ? r.value : [];
}

export async function saveTransaction(rec) {
  try { await DB.put('meta', { key: KEY, value: addTransaction(await loadTransactions(), rec) }); } catch (_) { /* a receipt is never worth failing a payment over */ }
}

// ---------- small building blocks ----------
export const isPayPageOpen = () => !!document.querySelector('.pay-page');
function closePage() { document.querySelectorAll('.pay-page').forEach((n) => n.remove()); document.body.classList.remove('pay-page-open'); }

async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what ? what + ' copied' : 'Copied'); } catch (_) { toast(text); }
}

// Static markup only (no user text goes in), so innerHTML is safe here.
const ICONS = {
  success: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="pay-ic-ring" cx="26" cy="26" r="24"/><path class="pay-ic-mark" d="M15 27l8 8 15-17"/></svg>',
  failed: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="pay-ic-ring" cx="26" cy="26" r="24"/><path class="pay-ic-mark" d="M18 18l16 16M34 18L18 34"/></svg>',
  warn: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="pay-ic-ring" cx="26" cy="26" r="24"/><path class="pay-ic-mark" d="M26 14v16M26 36v1"/></svg>',
  wait: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="pay-ic-ring" cx="26" cy="26" r="24"/><path class="pay-ic-mark" d="M26 14v13l8 5"/></svg>',
};
const icon = (kind) => { const n = el('div', { class: 'pay-ic pay-ic-' + kind }); n.innerHTML = ICONS[kind]; return n; };

function ref(label, value) {
  if (!value) return null;
  return el('div', { class: 'pay-ref' }, [
    el('span', { class: 'pay-ref-l', text: label }),
    el('code', { class: 'pay-ref-v', text: value }),
    el('button', { class: 'pay-copy', type: 'button', 'aria-label': 'Copy ' + label, text: 'Copy', onclick: () => copyText(value, label) }),
  ]);
}

function row(label, value, cls) {
  if (!value) return null;
  return el('div', { class: 'pay-row' + (cls ? ' ' + cls : '') }, [el('span', { text: label }), el('b', { text: value })]);
}

// The facts of the attempt: what it was, how much, when, and the ids somebody would quote.
function details(rec) {
  const when = new Date(rec.at);
  const failed = rec.status !== 'success';
  return el('div', { class: 'pay-details' }, [
    row('Item', 'MyNotes Pro Plan' + (rec.period ? ' · ' + (PERIOD_LABEL[rec.period] || rec.period) : '')),
    row('Amount', formatRupees(rec.amount) + (rec.period && rec.period !== 'lifetime' ? ' / ' + (rec.period === 'monthly' ? 'month' : 'year') : '')),
    row('Status', STATUS_LABEL[rec.status] || rec.status, 'pay-status pay-status-' + rec.status),
    row('Date', isNaN(when) ? '' : when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })),
    ref(rec.paymentId ? 'Transaction ID' : 'Reference', rec.paymentId || rec.orderId),
    rec.paymentId ? ref(refIdLabel(rec), rec.orderId) : null,
    failed && rec.code ? row('Code', rec.code + (rec.reason && rec.reason !== rec.code ? ' · ' + rec.reason : ''), 'pay-code') : null,
  ].filter(Boolean));
}

// "Save receipt" draws a proper receipt and hands it to the share sheet (pay-invoice.js), rather than printing this
// page. A print picked up the browser's own header, footer and page number, and looked different on every phone.
async function saveReceipt(rec) {
  const m = await import('./pay-invoice.js').catch(() => null);
  if (!m) { toast('Could not create the receipt'); return; }
  const alias = await getAlias().catch(() => '');
  const how = await m.shareInvoice(rec, alias);
  if (how === 'saved') toast('Receipt saved');
  else if (how === 'failed') toast('Could not create the receipt');
}

function shell(kind, children, rec) {
  const page = el('div', { class: 'pay-page pay-page-' + kind, role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'pay-card' }, [
      rec && rec.testMode ? el('div', { class: 'pay-test', text: 'TEST MODE · no real money' }) : null,
      ...children,
    ].filter(Boolean)),
  ]);
  closePage();
  document.body.appendChild(page);
  document.body.classList.add('pay-page-open');
  const first = page.querySelector('.btn.primary, .pay-copy');
  if (first) first.focus({ preventScroll: true });
  return page;
}

// ---------- success ----------
// Resolves when the person continues (button, ×, or backdrop). Nothing is switched on behind the page until then: the
// guided plan setup opens itself the moment Pro turns on, and it would sit on top of this page and hide the receipt.
export async function showSuccess(rec) {
  const name = (await getUserName().catch(() => '')) || '';
  return new Promise((resolve) => {
    let settled = false;
    const go = () => { if (settled) return; settled = true; closePage(); resolve('continue'); };
    const page = shell('success', [
      el('button', { class: 'pay-close', type: 'button', 'aria-label': 'Close', text: '×', onclick: go }),
      icon('success'),
      el('h1', { class: 'pay-h', text: name ? 'Welcome to Pro, ' + name + '!' : 'Welcome to Pro!' }),
      el('p', { class: 'pay-sub', text: 'Thank you. Your payment went through and your Pro Plan is on.' }),
      el('div', { class: 'pay-unlocked' }, [
        el('span', { text: 'All ' + APP_MODULES.length + ' features' }),
        el('span', { text: 'Screenshot update' }),
        el('span', { text: 'One-tap fund NAV' }),
        el('span', { text: 'Daily rates' }),
        el('span', { text: 'News Feed' }),
      ]),
      details(rec),
      el('div', { class: 'pay-next' }, [
        el('b', { text: 'Next: set up your yearly plan' }),
        el('p', { text: 'About two minutes: salary, savings and every spending line, with a live balance.' }),
      ]),
      el('div', { class: 'pay-actions' }, [
        el('button', { class: 'btn primary', type: 'button', text: 'Continue to plan setup', onclick: go }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Save receipt', onclick: () => saveReceipt(rec) }),
      ]),
      el('p', { class: 'pay-fine', text: 'This receipt is kept under Menu > Payment history.' }),
    ], rec);
    // Tapping the backdrop (outside the card) is also a dismiss.
    page.addEventListener('click', (e) => { if (e.target === page) go(); });
  });
}

// ---------- failure and unconfirmed ----------
// Resolves 'retry', 'recheck' or 'cancel'. `info` comes from failureInfo().
export function showFailure(rec, info) {
  return new Promise((resolve) => {
    const done = (v) => () => { closePage(); resolve(v); };
    const unconfirmed = info.kind === 'unconfirmed';
    const buttons = [];
    if (unconfirmed) buttons.push(el('button', { class: 'btn primary', type: 'button', text: 'Check again', onclick: done('recheck') }));
    else if (info.canRetry) buttons.push(el('button', { class: 'btn primary', type: 'button', text: 'Try again', onclick: done('retry') }));
    buttons.push(el('button', { class: 'btn ' + (buttons.length ? 'ghost' : 'primary'), type: 'button', text: unconfirmed ? 'Close' : 'Cancel', onclick: done('cancel') }));

    shell('failure', [
      icon(unconfirmed ? 'wait' : info.kind === 'cancelled' ? 'warn' : 'failed'),
      el('h1', { class: 'pay-h', text: info.title }),
      el('p', { class: 'pay-sub', text: info.message }),
      info.mayHaveCharged ? el('p', { class: 'pay-money', text: unconfirmed ? 'Your money is safe. Keep the reference below.' : 'If money left your account, keep the reference below.' }) : null,
      el('ul', { class: 'pay-tips' }, info.tips.map((t) => el('li', { text: t }))),
      details(rec),
      el('div', { class: 'pay-actions' }, buttons),
      el('button', { class: 'pay-linkbtn', type: 'button', text: 'Copy details for support', onclick: () => copyText(receiptText(rec), 'Details') }),
    ], rec);
  });
}

// ---------- looking at a saved record again ----------
export function showRecord(rec) {
  return new Promise((resolve) => {
    const ok = rec.status === 'success';
    const info = ok ? null : failureInfo({ code: rec.code, reason: rec.reason }, rec.kind || undefined);
    shell(ok ? 'success' : 'failure', [
      icon(ok ? 'success' : rec.status === 'unconfirmed' ? 'wait' : 'failed'),
      el('h1', { class: 'pay-h', text: ok ? 'Payment receipt' : info.title }),
      ok ? null : el('p', { class: 'pay-sub', text: info.message }),
      details(rec),
      el('div', { class: 'pay-actions' }, [
        el('button', { class: 'btn primary', type: 'button', text: ok ? 'Save receipt' : 'Save details', onclick: () => saveReceipt(rec) }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Copy details', onclick: () => copyText(receiptText(rec), 'Details') }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Close', onclick: () => { closePage(); resolve(); } }),
      ]),
    ], rec);
  });
}

// The Menu's Payment history: every attempt kept on this device, newest first.
export async function openPaymentHistory() {
  const list = await loadTransactions();
  const rows = list.map((rec) => {
    const when = new Date(rec.at);
    const b = el('button', { class: 'pay-hist-row', type: 'button' }, [
      el('span', { class: 'pay-pill pay-status-' + rec.status, text: STATUS_LABEL[rec.status] || rec.status }),
      el('span', { class: 'pay-hist-main' }, [
        el('b', { text: formatRupees(rec.amount) || 'MyNotes Pro' }),
        el('small', { text: (isNaN(when) ? '' : when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })) + (rec.testMode ? ' · test' : '') }),
      ]),
      el('span', { class: 'pay-hist-chev', text: '›' }),
    ]);
    b.addEventListener('click', async () => { await showRecord(rec); openPaymentHistory(); });
    return b;
  });
  shell('history', [
    el('h1', { class: 'pay-h', text: 'Payment history' }),
    el('p', { class: 'pay-sub', text: list.length ? 'Kept on this device only. Tap one to see it, copy its ID or save it.' : 'No payments yet.' }),
    el('div', { class: 'pay-hist' }, rows),
    el('div', { class: 'pay-actions' }, [el('button', { class: 'btn primary', type: 'button', text: 'Close', onclick: closePage })]),
  ]);
}
