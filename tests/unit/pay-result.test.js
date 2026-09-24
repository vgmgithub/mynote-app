import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KINDS, failureKind, failureInfo, formatRupees, transactionRecord, addTransaction, receiptText, MAX_SAVED, STATUS_LABEL,
} from '../../pay-core.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

// ---- which failure it is, chosen by the code Razorpay returned ----
test('the reason Razorpay gives picks the message, most specific first', () => {
  const k = (reason, extra = {}) => failureKind({ code: 'BAD_REQUEST_ERROR', reason, ...extra });
  assert.equal(k('payment_cancelled'), 'cancelled');
  assert.equal(k('input_validation_failed'), 'input');
  assert.equal(k('authentication_failed'), 'auth');
  assert.equal(k('payment_declined'), 'declined');
  assert.equal(k('insufficient_funds'), 'funds');
  assert.equal(k('card_expired'), 'expired');
});

test('when the reason is generic, the description is read for the cause', () => {
  const k = (description) => failureKind({ code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description });
  assert.equal(k('Your account does not have enough balance to complete the payment'), 'funds');
  assert.equal(k('Insufficient funds in the account'), 'funds');
  assert.equal(k('Card has expired'), 'expired');
  assert.equal(k('OTP verification failed'), 'auth');
  assert.equal(k('The card number is invalid'), 'input');
  assert.equal(k('The request timed out'), 'network');
  assert.equal(k('The bank declined the transaction'), 'declined');
  assert.equal(k('Payment was cancelled by the user'), 'cancelled');
});

test('with nothing specific, who was responsible decides', () => {
  assert.equal(failureKind({ code: 'GATEWAY_ERROR' }), 'service');
  assert.equal(failureKind({ code: 'SERVER_ERROR' }), 'service');
  assert.equal(failureKind({ source: 'gateway' }), 'service');
  assert.equal(failureKind({ source: 'business' }), 'service');
  assert.equal(failureKind({ source: 'bank' }), 'declined');
  assert.equal(failureKind({ source: 'customer' }), 'input');
});

test('anything unrecognised, empty or malformed is handled, never thrown on', () => {
  for (const bad of [undefined, null, {}, 'oops', 42, [], { reason: 7 }, { description: null }]) {
    assert.equal(failureKind(bad), 'unknown', JSON.stringify(bad));
    assert.ok(failureInfo(bad).title, 'always has something to say');
  }
});

test('every kind has a title, a message and at least one thing to do, and says whether to retry and whether money may have left', () => {
  for (const kind of KINDS) {
    const i = failureInfo(null, kind);
    assert.equal(i.kind, kind);
    assert.ok(i.title.length > 5 && i.message.length > 15, kind);
    assert.ok(Array.isArray(i.tips) && i.tips.length >= 1, kind + ' needs advice');
    assert.equal(typeof i.canRetry, 'boolean', kind);
    assert.equal(typeof i.mayHaveCharged, 'boolean', kind);
  }
});

// The honesty rules. A message must never claim "nothing was charged" when the payment service or the network was at
// fault, because in those cases money may have left and the person needs to keep the reference.
test('a message says "nothing was charged" only when that is true', () => {
  for (const kind of KINDS) {
    const i = failureInfo(null, kind);
    const claimsNone = /nothing was charged/i.test(i.message);
    if (i.mayHaveCharged) assert.equal(claimsNone, false, kind + ' may have charged, so it must not say nothing was');
  }
  for (const kind of ['cancelled', 'input', 'auth', 'declined', 'funds', 'expired']) {
    assert.equal(failureInfo(null, kind).mayHaveCharged, false, kind + ' is a failure before any money moves');
  }
  for (const kind of ['service', 'network', 'unconfirmed', 'unknown']) {
    assert.equal(failureInfo(null, kind).mayHaveCharged, true, kind);
  }
});

test('"confirming your payment" says the money is safe, and offers no retry that could charge twice', () => {
  const i = failureInfo(null, 'unconfirmed');
  assert.equal(i.canRetry, false, 'paying again would charge a second time');
  assert.match(i.message, /money is safe/i);
});

test('the technical codes are kept for support, but not used as the message', () => {
  const i = failureInfo({ code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: 'Payment processing failed' });
  assert.equal(i.codes, 'BAD_REQUEST_ERROR · payment_failed');
  assert.doesNotMatch(i.message, /BAD_REQUEST|payment_failed/);
});

// ---- the record ----
test('amounts are shown in rupees', () => {
  assert.equal(formatRupees(39900), '₹399');
  assert.equal(formatRupees(39950), '₹399.50');
  assert.equal(formatRupees(100), '₹1');
  assert.equal(formatRupees('x'), '');
  assert.equal(formatRupees(-5), '');
});

test('a record quotes the payment id, and falls back to the order id when there is none', () => {
  const ok = transactionRecord({ status: 'success', orderId: 'order_A', paymentId: 'pay_B', amount: 39900, testMode: true });
  assert.equal(ok.id, 'pay_B');
  const noPay = transactionRecord({ status: 'failed', orderId: 'order_A', amount: 39900 });
  assert.equal(noPay.id, 'order_A', 'a failure before a payment id exists is still findable by its order');
  assert.equal(noPay.currency, 'INR');
  assert.ok(!isNaN(new Date(noPay.at)));
});

test('saved records are newest first, capped, and a retry of the same payment does not pile up', () => {
  const rec = (id, status) => transactionRecord({ status, orderId: 'o_' + id, paymentId: id, amount: 39900, at: '2026-09-22T10:00:00Z' });
  let list = [];
  list = addTransaction(list, rec('pay_1', 'failed'));
  list = addTransaction(list, rec('pay_2', 'success'));
  assert.deepEqual(list.map((r) => r.id), ['pay_2', 'pay_1'], 'newest first');
  list = addTransaction(list, rec('pay_1', 'failed'));
  assert.equal(list.length, 2, 'the same id and status replaces, it does not duplicate');
  assert.equal(list[0].id, 'pay_1');
  list = addTransaction(list, rec('pay_1', 'success'));
  assert.equal(list.length, 3, 'a failed attempt and a later success are different facts');
  let big = [];
  for (let i = 0; i < MAX_SAVED + 10; i++) big = addTransaction(big, rec('pay_' + i, 'failed'));
  assert.equal(big.length, MAX_SAVED);
  assert.deepEqual(addTransaction(null, rec('p', 'failed')).length, 1, 'a missing list is treated as empty');
});

test('the copied text names the status, and a failure never reads like a receipt', () => {
  const ok = receiptText(transactionRecord({ status: 'success', orderId: 'order_A', paymentId: 'pay_B', amount: 39900, testMode: true }));
  assert.match(ok, /receipt \(TEST MODE - no real money\)/);
  assert.match(ok, /Transaction ID: pay_B/);
  assert.match(ok, /Order ID: order_A/);
  assert.match(ok, /Status: Paid/);
  const bad = receiptText(transactionRecord({ status: 'failed', orderId: 'order_A', amount: 39900, code: 'GATEWAY_ERROR', reason: 'payment_failed' }));
  assert.match(bad, /payment record/);
  assert.doesNotMatch(bad, /receipt/i, 'a failure is a record, not a receipt');
  assert.match(bad, /Code: GATEWAY_ERROR · payment_failed/);
  assert.deepEqual(Object.keys(STATUS_LABEL).sort(), ['failed', 'success', 'unconfirmed']);
});

// ---- the pages and how they are wired ----
test('the flow shows a page for success, failure and unconfirmed, and never marks paid itself', () => {
  const pay = read('pay.js');
  assert.match(pay, /showSuccess\(/);
  assert.match(pay, /showFailure\(/);
  assert.match(pay, /failureInfo\(null, 'unconfirmed'\)/, 'a payment we could not confirm has its own page');
  assert.match(pay, /if \(choice === 'recheck'\) await confirm\(/, 'and can be checked again');
  assert.match(pay, /retry = choice === 'retry'/);
  assert.match(pay, /rzp\.close\(\)/, 'Razorpay\'s window is closed before ours opens');
  assert.match(pay, /Try again starts a fresh subscription/, 'a failed subscription is never reused');
  assert.match(pay, /await saveTransaction\(rec\)/, 'every attempt is kept');
});

test('Pro does not switch on behind the success page: the setup waits for the person to continue', () => {
  const pay = read('pay.js');
  const succeed = pay.slice(pay.indexOf('async function succeed'), pay.indexOf('// Ask the server to confirm'));
  assert.ok(succeed.indexOf('showSuccess(rec)') < succeed.indexOf('applyDeferredPlan()'), 'the page comes first, the flip after');
  const app = read('app.js');
  assert.match(app, /if \(plan === 'paid' && document\.querySelector\('\.pay-page'\)\) \{ _deferredPlan = plan; return; \}/, 'Pro switching on is held while a result page is open');
  assert.match(app, /export async function applyDeferredPlan/);
});

test('the success page waits for the user, has a close button and backdrop dismiss, and shows the id with a Copy button', () => {
  const ui = read('pay-result.js');
  assert.match(ui, /pay-close/, 'close button present');
  assert.match(ui, /e\.target === page.*go\(\)|go\(\).*e\.target === page/, 'backdrop click resolves');
  assert.match(ui, /Continue to plan setup/);
  assert.match(ui, /Save receipt/);
  assert.match(ui, /class: 'pay-copy'/, 'the ids have a Copy button');
  assert.match(ui, /Transaction ID/);
  assert.match(ui, /saveReceipt\(rec\)/, 'Save receipt draws a receipt rather than printing the page');
  assert.equal(/window\.print\(\)/.test(ui), false, 'the browser print path is gone');
});

test('the failure page offers Try again only when trying again is safe, and always a way out', () => {
  const ui = read('pay-result.js');
  assert.match(ui, /else if \(info\.canRetry\) buttons\.push\([^)]*Try again/s);
  assert.match(ui, /text: unconfirmed \? 'Close' : 'Cancel'/);
  assert.match(ui, /Check again/);
  assert.match(ui, /Copy details for support/);
});

// The piggy clips: the outcome shown as a short animation that plays once and rests on its last frame.
test('the piggy plays for a real success or failure only, rests on its last frame, and ships offline', async () => {
  const ui = read('pay-result.js');
  assert.match(ui, /const ART = \{ success: 'icons\/pay\/success', failed: 'icons\/pay\/failure' \};/, 'only two outcomes have art');
  assert.match(ui, /if \(!base\) return icon\(kind\);/, 'unconfirmed and cancelled keep their plain icons');
  assert.match(ui, /art\('success'\)/);
  assert.match(ui, /art\(unconfirmed \? 'wait' : info\.kind === 'cancelled' \? 'warn' : 'failed'\)/, 'a sad face never says "failed" to an unconfirmed or cancelled payment');
  assert.match(ui, /art\(ok \? 'success' : rec\.status === 'unconfirmed' \? 'wait' : rec\.kind === 'cancelled' \? 'warn' : 'failed', true\)/, 'a reopened receipt shows the still; unconfirmed and cancelled keep their icons');
  const css = read('styles.css');
  assert.match(css, /\.pay-art::before \{[^}]*inset: 1\.5%/, 'the placeholder sits inside the image rim, so no hairline shows round the last frame');
  assert.match(css, /\.pay-art-img \{[^}]*clip-path: circle\(49\.3%\)/);
  assert.match(ui, /prefers-reduced-motion: reduce/, 'reduced motion gets the still');
  assert.match(ui, /URL\.createObjectURL\(blob\)/, 'a fresh address per showing, so a second failure plays again');
  assert.match(ui, /wrap\.replaceWith\(icon\(kind\)\)/, 'an image that cannot load falls back to the icon');
  const sw = read('service-worker.js');
  const { readFileSync } = await import('node:fs');
  for (const f of ['success', 'failure']) {
    for (const [name, animated] of [[f + '.webp', true], [f + '-end.webp', false]]) {
      assert.ok(sw.includes("'./icons/pay/" + name + "'"), name + ' is precached');
      const b = readFileSync(new URL('../../icons/pay/' + name, import.meta.url));
      assert.equal(b.slice(0, 4).toString() + b.slice(8, 12).toString(), 'RIFFWEBP', name + ' is a WebP');
      assert.ok(b.length < (animated ? 300 : 40) * 1024, name + ' stays small: ' + b.length);
      // Walk the chunks: VP8X alpha flag, ANIM loop count, one ANMF per frame.
      let i = 12, alpha = false, loop = null, frames = 0;
      while (i + 8 <= b.length) {
        const tag = b.slice(i, i + 4).toString(), size = b.readUInt32LE(i + 4);
        if (tag === 'VP8X') alpha = !!(b[i + 8] & 0x10);
        if (tag === 'ANIM') loop = b.readUInt16LE(i + 8 + 4);
        if (tag === 'ANMF') frames++;
        i += 8 + size + (size & 1);
      }
      assert.ok(alpha, name + ' has transparent corners, so it sits on any card colour');
      if (animated) {
        assert.equal(loop, 1, name + ' plays once and holds its last frame - not a loop');
        assert.ok(frames >= 10, name + ' is actually animated');
      } else assert.equal(frames, 0, name + ' is a still');
    }
  }
});

test('the history is reachable from the Menu once there is something in it, and every file is cached offline', () => {
  assert.match(read('app.js'), /Payment history/);
  const sw = read('service-worker.js');
  assert.match(sw, /\.\/pay-result\.js/);
  assert.match(sw, /\.\/pay-core\.js/);
  assert.match(sw, /\.\/pay-invoice\.js/);
  assert.equal(/is-printing-receipt/.test(read('styles.css')), false, 'the print rules went with the print path');
});

test('the receipt image stands on its own: who it is from, which install, and what to do next', () => {
  const inv = read('pay-invoice.js');
  // The anonymous name is the whole point of the corner: support can match a
  // receipt to an install without anybody naming themselves. It is passed in,
  // so this file stays drawable on its own.
  assert.match(read('pay-result.js'), /getAlias\(\)/);
  assert.match(inv, /shareInvoice\(rec, alias\)/);
  assert.match(inv, /'@' \+ alias/);
  assert.equal(/from '\.\/app\.js'/.test(inv), false, 'the receipt draws without pulling in the app');
  assert.match(inv, /icons\/icon-pro\.png/, 'the Pro icon is the header mark');
  // Paying does not put anything in a cloud, and this is where people assume it did.
  assert.match(inv, /Take a regular backup/);
  assert.match(inv, /Backup & Restore/);
  // A receipt, and honest about not being more than one.
  assert.match(inv, /Not a tax invoice/);
  assert.match(inv, /rec\.testMode/, 'a test payment says so on the receipt');
  // Drawn, then shared as a file: no print dialog anywhere in it.
  assert.match(inv, /toBlob/);
  assert.equal(/window\.print/.test(inv), false);
});

// The receipt for the running term shows its REAL end (re-dated by the admin, renewed, or expired),
// not the date saved when it was bought.
test('the current receipt follows the live term, including an expiry the admin set', async () => {
  const { withLiveTerm, termLabel, currentReceiptId } = await import('../../pay-core.js');
  const rec = { id: 'pay_1', status: 'success', period: 'monthly', until: '2026-10-01T00:00:00.000Z' };
  const list = [{ id: 'x', status: 'failed' }, rec, { id: 'pay_0', status: 'success' }];
  assert.equal(currentReceiptId(list), 'pay_1');
  const live = withLiveTerm(rec, { plan: 'paid', until: '2026-09-23T10:00:00.000Z', renewing: true }, true);
  assert.equal(live.until, '2026-09-23T10:00:00.000Z');
  assert.equal(termLabel(live), 'Renews on');
  const ended = withLiveTerm(rec, { plan: 'free', endedAt: '2026-09-23T09:00:00.000Z' }, true);
  assert.equal(ended.until, '2026-09-23T09:00:00.000Z');
  assert.equal(termLabel(ended), 'Expired on');
  assert.equal(withLiveTerm(rec, { plan: 'free', endedAt: 'z' }, false), rec, 'older receipts keep their own date');
  assert.equal(termLabel({ renewing: false }), 'Access until');
});

// A subscription needs a card that allows recurring payments; say so instead of "expired card".
test('a card that cannot do auto-pay is named as such, and test mode names the card that works', async () => {
  const { failureKind, failureInfo, SUB_TEST_CARD } = await import('../../pay-core.js');
  assert.equal(failureKind({ description: 'Card not supported for recurring payments' }), 'recurring');
  assert.equal(failureKind({ description: 'This card does not support e-mandate' }), 'recurring');
  assert.equal(failureKind({ reason: 'international_transaction_not_allowed' }), 'international');
  assert.equal(failureKind({ description: 'Your card has expired' }), 'expired', 'unchanged for a plainly expired card');
  assert.equal(SUB_TEST_CARD, '4718 6091 0820 4366');
  const live = failureInfo({ description: 'recurring not supported' });
  assert.equal(live.tips.some((t) => t.includes(SUB_TEST_CARD)), false, 'live mode never mentions a test card');
  const test = failureInfo({ description: 'recurring not supported' }, null, { testMode: true });
  assert.equal(test.tips.some((t) => t.includes(SUB_TEST_CARD)), true);
  assert.equal(failureInfo({ reason: 'payment_cancelled' }, null, { testMode: true }).tips.some((t) => t.includes(SUB_TEST_CARD)), false, 'not on a cancel');
});
