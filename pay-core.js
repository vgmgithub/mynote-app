// The pure part of the checkout: no browser, no network, so it can be tested on its own.

// What to say for each way step 1 (creating the order) can fail. Plain words; the technical cause stays on the server.
export function createOrderMessage(status) {
  if (status === 503) return 'Payments are not set up on this server yet.';
  if (status === 401) return 'The payment service refused this server’s login. Nothing was charged.';
  if (status === 400) return 'That request was not valid. Nothing was charged.';
  return 'Could not start the payment. Nothing was charged. Try again in a moment.';
}

// ---- Failure: what went wrong, said in plain words, chosen by the code Razorpay gives back ----
//
// Razorpay reports a failed payment as { code, description, source, step, reason, metadata }. `reason` is the most
// specific of these and is used first; `source` says who was responsible (the customer, the bank, or the payment
// service); the description is read only as a last resort, for words like "insufficient" or "expired".
//
// Each answer says three things: what happened, whether trying again can help, and whether money may have left the
// account. The last matters most: a bank that took the money and a service that timed out are different problems and
// deserve different reassurance, and neither should be glossed over.
export const KINDS = ['cancelled', 'input', 'auth', 'declined', 'funds', 'expired', 'service', 'network', 'unconfirmed', 'unknown'];

const F = {
  cancelled: { title: 'Payment cancelled', message: 'You closed the payment before it finished, so nothing was charged.', canRetry: true, mayHaveCharged: false,
    tips: ['Tap Try again whenever you are ready.'] },
  input: { title: 'Some details did not look right', message: 'The card, UPI ID or other details were not accepted. Nothing was charged.', canRetry: true, mayHaveCharged: false,
    tips: ['Check the card number, expiry date and CVV, or the UPI ID.', 'Then tap Try again.'] },
  auth: { title: 'Your bank could not verify this payment', message: 'The one-time password or approval step did not complete. Nothing was charged.', canRetry: true, mayHaveCharged: false,
    tips: ['Make sure you can receive the OTP or approve the request in your bank app.', 'Try again, or pick a different way to pay.'] },
  declined: { title: 'Your bank declined the payment', message: 'The bank did not approve this payment. Nothing was charged.', canRetry: true, mayHaveCharged: false,
    tips: ['Try a different card or UPI app.', 'If it keeps happening, your bank can tell you why.'] },
  funds: { title: 'Not enough balance', message: 'The account or card did not have enough available to cover this payment. Nothing was charged.', canRetry: true, mayHaveCharged: false,
    tips: ['Use a different card, account or UPI app, or add funds and try again.'] },
  expired: { title: 'That card cannot be used', message: 'The card looks expired or is not enabled for online payments. Nothing was charged.', canRetry: true, mayHaveCharged: false,
    tips: ['Try a different card, or a UPI app.'] },
  service: { title: 'The payment service had a problem', message: 'This was on our side, not yours. It did not complete.', canRetry: true, mayHaveCharged: true,
    tips: ['Wait a minute and tap Try again.', 'If money was taken, your bank normally returns it within about a week. If it does not, contact us with the reference below.'] },
  network: { title: 'The connection dropped', message: 'The payment may not have finished because the internet connection was lost.', canRetry: true, mayHaveCharged: true,
    tips: ['Check your connection, then tap Try again.', 'If money was taken, contact us with the reference below and we will check it.'] },
  unconfirmed: { title: 'We are confirming your payment', message: 'Your payment went through, but we could not switch Pro on yet. Your money is safe.', canRetry: false, mayHaveCharged: true,
    tips: ['Tap Check again in a moment.', 'If it still does not work, contact us with the reference below and we will switch it on for you.'] },
  unknown: { title: 'The payment did not go through', message: 'Something stopped the payment. It is not clear what.', canRetry: true, mayHaveCharged: true,
    tips: ['Try again, or use a different way to pay.', 'If money was taken, your bank normally returns it within about a week; contact us with the reference below if it does not.'] },
};

const has = (text, ...words) => words.some((w) => text.includes(w));

// The kind of failure, from a Razorpay error object (or nothing at all).
export function failureKind(error) {
  const e = error && typeof error === 'object' ? error : {};
  const reason = String(e.reason || '').toLowerCase();
  const code = String(e.code || '').toUpperCase();
  const source = String(e.source || '').toLowerCase();
  const text = String(e.description || '').toLowerCase();

  // The most specific signal first: the reason.
  if (reason === 'payment_cancelled') return 'cancelled';
  if (reason === 'input_validation_failed') return 'input';
  if (reason === 'authentication_failed') return 'auth';
  if (reason === 'payment_declined') return 'declined';
  if (has(reason, 'insufficient')) return 'funds';
  if (has(reason, 'expired')) return 'expired';

  // Words in the description, for the cases the reason does not name.
  if (has(text, 'insufficient', 'not enough balance', 'enough balance', 'low balance')) return 'funds';
  if (has(text, 'expired', 'not enabled', 'not supported for online')) return 'expired';
  if (has(text, 'cancelled', 'canceled')) return 'cancelled';
  if (has(text, 'otp', 'authentication', '3d secure', 'not authenticated')) return 'auth';
  if (has(text, 'invalid', 'incorrect', 'wrong')) return 'input';
  if (has(text, 'timeout', 'timed out', 'network', 'connection')) return 'network';
  if (has(text, 'declined', 'rejected', 'not permitted', 'restricted', 'limit')) return 'declined';

  // Who was responsible, when nothing above was specific.
  if (code === 'GATEWAY_ERROR' || code === 'SERVER_ERROR' || source === 'gateway' || source === 'business') return 'service';
  if (source === 'bank' || source === 'issuer') return 'declined';
  if (source === 'customer') return 'input';
  return 'unknown';
}

// Everything the failure page shows. `error` is the raw object; nothing is invented that Razorpay did not say.
export function failureInfo(error, kindOverride) {
  const kind = kindOverride && F[kindOverride] ? kindOverride : failureKind(error);
  const e = error && typeof error === 'object' ? error : {};
  const codes = [e.code, e.reason].filter(Boolean).join(' · ');
  return { kind, ...F[kind], tips: [...F[kind].tips], codes };
}

// ---- The transaction record, kept on the device so it can be looked at again ----
export const MAX_SAVED = 30;

export const formatRupees = (paise) => {
  const n = Number(paise);
  if (!Number.isFinite(n) || n < 0) return '';
  return '₹' + (n / 100).toLocaleString('en-IN', { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 });
};

// One record per attempt. `id` is what a person quotes: the payment id if there is one, otherwise the order id.
export function transactionRecord({ status, orderId, paymentId, amount, currency, at, code, reason, testMode, kind }) {
  const id = paymentId || orderId || '';
  return {
    id, orderId: orderId || '', paymentId: paymentId || '', status,
    amount: Number(amount) || 0, currency: currency || 'INR',
    at: at || new Date().toISOString(),
    code: code || '', reason: reason || '', kind: kind || '',
    testMode: !!testMode,
  };
}

// Newest first, no duplicates by id and status, capped. A retry of the same payment updates rather than piles up.
export function addTransaction(list, rec, cap = MAX_SAVED) {
  const rest = (Array.isArray(list) ? list : []).filter((r) => !(r.id === rec.id && r.status === rec.status));
  return [rec, ...rest].slice(0, cap);
}

export const STATUS_LABEL = { success: 'Paid', failed: 'Failed', unconfirmed: 'Awaiting confirmation' };

// The plain-text form of a receipt, for copying. A failed attempt reads as such, so it is never mistaken for a receipt.
export function receiptText(rec) {
  const when = new Date(rec.at);
  const lines = [
    'MyNotes ' + (rec.status === 'success' ? 'receipt' : 'payment record') + (rec.testMode ? ' (TEST MODE - no real money)' : ''),
    'Item: MyNotes Pro Plan',
    'Amount: ' + (formatRupees(rec.amount) || '-') + ' ' + rec.currency,
    'Status: ' + (STATUS_LABEL[rec.status] || rec.status),
    'Transaction ID: ' + (rec.paymentId || '-'),
    'Order ID: ' + (rec.orderId || '-'),
    'Date: ' + (isNaN(when) ? '-' : when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })),
  ];
  if (rec.code) lines.push('Code: ' + rec.code + (rec.reason && rec.reason !== rec.code ? ' · ' + rec.reason : ''));
  return lines.join('\n');
}
