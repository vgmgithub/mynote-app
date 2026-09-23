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
import { openPlanSetupNow } from './plan-setup-ui.js';
import { SERVER_URL, IS_PRODUCTION } from './config.js';
import { createOrderMessage, failureInfo, transactionRecord } from './pay-core.js';
import { showSuccess, showFailure, saveTransaction } from './pay-result.js';
import { storePaidTerm } from './sender.js';

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
  // Switch Pro on in the app (sets body.dataset.plan = 'paid'), then go straight to the yearly plan wizard.
  await applyDeferredPlan();
  // Only while Pro is actually on: a short test term can run out while the receipt is still being read.
  if (document.body.dataset.plan === 'paid') await openPlanSetupNow();
}

// Ask the server to confirm the payment. The page shown depends on what it says. `refField` and
// `body` differ between the two flows below (subscription vs the older one-time order), but what
// happens with the answer - success, or "we are confirming, check again" - is identical either way.
async function confirm(installId, base, verifyBody) {
  let res;
  try { res = await post('/api/verify-payment', verifyBody); } catch (_) { res = null; }

  if (res && res.status === 200 && res.json.success) {
    // The end of the term is stored ON the receipt, not looked up when it is opened: a receipt is a
    // record of what was bought, and months later the current plan may be a different term altogether
    // (or none). `until` is absent for lifetime and for a server too old to send it, so every reader
    // has to cope with it missing.
    // The term is also stored as the plan right away (sender.js storePaidTerm), so the "ends soon" card
    // and the expiry are armed from this moment, not from the next plan check.
    await storePaidTerm(res.json).catch(() => {});
    await succeed(transactionRecord({ ...base, status: 'success', until: res.json.until || null, testClock: res.json.testClock, termMs: res.json.termMs }));
    return;
  }
  // Razorpay took the payment but we could not confirm it. Money may have moved, so this is never shown as a plain
  // failure: it says so, gives the reference, and offers to check again.
  const rec = transactionRecord({ ...base, status: 'unconfirmed', kind: 'unconfirmed', code: res ? 'HTTP_' + res.status : 'NO_RESPONSE' });
  await saveTransaction(rec);
  const choice = await showFailure(rec, failureInfo(null, 'unconfirmed'));
  if (choice === 'recheck') await confirm(installId, base, verifyBody);
}

// Monthly or annual - a recurring mandate (Razorpay Subscriptions). This is the only path the app
// offers today: lifetime is priced on the server but not yet on sale (SELLABLE_PERIODS), so passing
// it here would simply be refused by /api/create-order.
export async function startProCheckout(period = 'annual') {
  if (IS_PRODUCTION) { toast('Pro is not on sale yet'); return; }
  if (!SERVER_URL) { toast('Payments are not available here'); return; }
  if (busy) return;
  busy = true;
  let retry = false;
  try {
    if (!navigator.onLine) { toast('You are offline. Payments need the internet.'); return; }
    const installId = await getInstallId();
    if (!installId) { toast('This device is not set up yet. Open the app again in a moment.'); return; }

    const created = await post('/api/create-order', { installId, period });
    if (created.status !== 200 || !created.json.subscription_id) { toast(createOrderMessage(created.status, created.json.reason)); return; }
    const sub = created.json;
    const testMode = String(sub.key_id).startsWith('rzp_test_');
    const cadence = period === 'monthly' ? 'every month' : 'every year';

    await loadCheckout();
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      const rzp = new window.Razorpay({
        key: sub.key_id,                          // the public id, from the server's answer
        subscription_id: sub.subscription_id,      // the amount and currency live on the Plan behind this, not here
        name: 'MyNotes',
        description: 'MyNotes Pro · charged ' + cadence + (testMode ? ' (test mode: no real money)' : ''),
        theme: { color: '#0ea5e9' },
        // Success: hand all three values to our server, which decides. The browser never decides "paid".
        handler: async (resp) => {
          settled = true;
          const base = { orderId: sub.subscription_id, paymentId: resp.razorpay_payment_id, amount: sub.amount, currency: sub.currency, testMode, period };
          try {
            await confirm(installId, base, {
              installId,
              razorpay_subscription_id: resp.razorpay_subscription_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
          } finally { resolve(); }
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
          status: 'failed', orderId: meta.subscription_id || sub.subscription_id, paymentId: meta.payment_id || '',
          amount: sub.amount, currency: sub.currency, code: err.code, reason: err.reason, kind: info.kind, testMode, period,
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
  // Try again starts a fresh subscription: one that has failed cannot be reused.
  if (retry) startProCheckout(period);
}
