// Razorpay Standard Checkout, browser side.
//
// The steps, in order:
//   1. Ask OUR server for an order (POST /api/create-order). The server sets the price; nothing here names one.
//   2. Load Razorpay's own checkout script and open its window with that order.
//   3. On success Razorpay hands back three values; send them to OUR server (POST /api/verify-payment), which
//      checks the signature and asks Razorpay to confirm before switching Pro on.
//   4. Show the result on its own page (pay-result.js): a welcome, or what went wrong and what to do about it.
//
// Only the PUBLIC key id ever reaches this file, and it comes from the server's answer. The secret never does.
//
// This is offered only where purchases are not live: the menu and the plan comparison show it off production, and
// startProCheckout refuses to run on production, where Pro is not on sale (Privacy, Terms and the comparison say so).
import { toast, getInstallId, applyDeferredPlan } from './app.js';
import { SERVER_URL, IS_PRODUCTION } from './config.js';
import { createOrderMessage, failureInfo, transactionRecord } from './pay-core.js';
import { showSuccess, showFailure, saveTransaction } from './pay-result.js';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptLoad = null;
let busy = false;

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptLoad) {
    scriptLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CHECKOUT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptLoad = null; reject(new Error('Could not load the payment window. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return scriptLoad;
}

async function post(path, body) {
  const r = await fetch(SERVER_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch (_) { json = null; }
  return { status: r.status, json: json || {} };
}

// Turn a success into a page, hand control on once the person has read it, then let Pro switch on.
async function succeed(rec) {
  await saveTransaction(rec);
  await showSuccess(rec);
  // Only now does Pro switch on in the app, which opens the guided plan setup on its own.
  await applyDeferredPlan();
}

// Ask the server to confirm the payment. The page shown depends on what it says.
async function confirm(installId, order, resp, testMode) {
  const base = { orderId: order.order_id, paymentId: resp.razorpay_payment_id, amount: order.amount, currency: order.currency, testMode };
  let res;
  try {
    res = await post('/api/verify-payment', {
      installId,
      razorpay_order_id: resp.razorpay_order_id,
      razorpay_payment_id: resp.razorpay_payment_id,
      razorpay_signature: resp.razorpay_signature,
    });
  } catch (_) { res = null; }

  if (res && res.status === 200 && res.json.success) {
    await succeed(transactionRecord({ ...base, status: 'success' }));
    return;
  }
  // Razorpay took the payment but we could not confirm it. Money may have moved, so this is never shown as a plain
  // failure: it says so, gives the reference, and offers to check again.
  const rec = transactionRecord({ ...base, status: 'unconfirmed', kind: 'unconfirmed', code: res ? 'HTTP_' + res.status : 'NO_RESPONSE' });
  await saveTransaction(rec);
  const choice = await showFailure(rec, failureInfo(null, 'unconfirmed'));
  if (choice === 'recheck') await confirm(installId, order, resp, testMode);
}

export async function startProCheckout() {
  if (IS_PRODUCTION) { toast('Pro is not on sale yet'); return; }
  if (!SERVER_URL) { toast('Payments are not available here'); return; }
  if (busy) return;
  busy = true;
  let retry = false;
  try {
    if (!navigator.onLine) { toast('You are offline. Payments need the internet.'); return; }
    const installId = await getInstallId();
    if (!installId) { toast('This device is not set up yet. Open the app again in a moment.'); return; }

    const created = await post('/api/create-order', { installId });
    if (created.status !== 200 || !created.json.order_id) { toast(createOrderMessage(created.status)); return; }
    const order = created.json;
    const testMode = String(order.key_id).startsWith('rzp_test_');

    await loadCheckout();
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      const rzp = new window.Razorpay({
        key: order.key_id,                       // the public id, from the server's answer
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: 'MyNotes',
        description: 'MyNotes Pro' + (testMode ? ' (test mode: no real money)' : ''),
        theme: { color: '#0ea5e9' },
        // Success: hand all three values to our server, which decides. The browser never decides "paid".
        handler: async (resp) => {
          settled = true;
          try { await confirm(installId, order, resp, testMode); } finally { resolve(); }
        },
        // Closed without paying: not a failure, so a quiet note rather than a page.
        modal: { ondismiss: () => { if (!settled) toast('Payment cancelled'); finish(); } },
      });
      // A failed payment gets a page of its own, chosen by the error code. Razorpay's window is closed first so the two
      // are not on screen together.
      rzp.on('payment.failed', async (resp) => {
        if (settled) return;
        settled = true;
        try { rzp.close(); } catch (_) { /* already closed */ }
        const err = (resp && resp.error) || {};
        const meta = err.metadata || {};
        const info = failureInfo(err);
        const rec = transactionRecord({
          status: 'failed', orderId: meta.order_id || order.order_id, paymentId: meta.payment_id || '',
          amount: order.amount, currency: order.currency, code: err.code, reason: err.reason, kind: info.kind, testMode,
        });
        await saveTransaction(rec);
        const choice = await showFailure(rec, info);
        retry = choice === 'retry';
        resolve();
      });
      rzp.open();
    });
  } catch (e) {
    toast(e && e.message ? e.message : 'Something went wrong. Nothing was charged.');
  } finally {
    busy = false;
  }
  // Try again starts a fresh order: an order that has failed cannot be reused.
  if (retry) startProCheckout();
}
