// Razorpay Standard Checkout, browser side.
//
// The steps, in order:
//   1. Ask OUR server for an order (POST /api/create-order). The server sets the price; nothing here names one.
//   2. Load Razorpay's own checkout script and open its modal with that order.
//   3. On success Razorpay hands back three values; send them to OUR server (POST /api/verify-payment), which
//      checks the signature and asks Razorpay to confirm before switching Pro on.
//   4. Re-check the plan, so the app flips to Pro at once.
//
// Only the PUBLIC key id ever reaches this file, and it comes from the server's answer. The secret never does.
//
// This is offered only where purchases are not live: the menu shows it off production, and startProCheckout
// refuses to run on production, where Pro is not on sale (Privacy, Terms and the comparison table say so).
import { toast, getInstallId, appAlert } from './app.js';
import { SERVER_URL, IS_PRODUCTION } from './config.js';
import { checkPlan } from './sender.js';
import { createOrderMessage } from './pay-core.js';

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

export async function startProCheckout() {
  if (IS_PRODUCTION) { toast('Pro is not on sale yet'); return; }
  if (!SERVER_URL) { toast('Payments are not available here'); return; }
  if (busy) return;
  busy = true;
  try {
    if (!navigator.onLine) { toast('You are offline. Payments need the internet.'); return; }
    const installId = await getInstallId();
    if (!installId) { toast('This device is not set up yet. Open the app again in a moment.'); return; }

    const created = await post('/api/create-order', { installId });
    if (created.status !== 200 || !created.json.order_id) { toast(createOrderMessage(created.status)); return; }
    const order = created.json;

    await loadCheckout();
    await new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: order.key_id,                       // the public id, from the server's answer
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: 'MyNotes',
        description: 'MyNotes Pro' + (String(order.key_id).startsWith('rzp_test_') ? ' (test mode: no real money)' : ''),
        theme: { color: '#0ea5e9' },
        // Success: hand all three values to our server, which decides. The browser never decides "paid".
        handler: async (resp) => {
          try {
            const v = await post('/api/verify-payment', {
              installId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            if (v.status === 200 && v.json.success) {
              toast('Payment confirmed. Welcome to Pro!');
              await checkPlan().catch(() => {});
            } else {
              // Money may have been taken even though we could not confirm it, so give them the reference.
              await appAlert('We could not confirm this payment automatically.\n\nIf money was taken, keep this reference and contact support: ' + resp.razorpay_payment_id);
            }
          } catch (_) {
            await appAlert('We could not reach the server to confirm your payment.\n\nIf money was taken, keep this reference and contact support: ' + resp.razorpay_payment_id);
          } finally { resolve(); }
        },
        // Closed without paying.
        modal: { ondismiss: () => { toast('Payment cancelled'); resolve(); } },
      });
      rzp.on('payment.failed', (resp) => {
        const why = resp && resp.error && resp.error.description ? resp.error.description : 'The payment did not go through.';
        toast('Payment failed: ' + why);
      });
      rzp.open();
    });
  } catch (e) {
    toast(e && e.message ? e.message : 'Something went wrong. Nothing was charged.');
  } finally {
    busy = false;
  }
}
