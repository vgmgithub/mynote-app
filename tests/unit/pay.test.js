import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrderMessage } from '../../pay-core.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('the server price is the price the app shows', () => {
  const server = /PRO_AMOUNT_PAISE = (\d+)/.exec(read('server/lib/razorpay.js'));
  assert.ok(server, 'the server states its price');
  // plan-compare.js imports the browser app, so its price is read from the source text rather than imported.
  const shown = /PRO_PRICE = '\\u20B9(\d+)'/.exec(read('plan-compare.js'));
  assert.ok(shown, 'the app states its price');
  assert.equal(Number(server[1]), Number(shown[1]) * 100);
});

test('the buy button exists only off production, and never for somebody already on Pro', () => {
  const app = read('app.js');
  assert.match(app, /if \(!IS_PRODUCTION && !isPaidPlan\(\)\)[\s\S]{0,400}Buy Pro/);
  const pay = read('pay.js');
  assert.match(pay, /if \(IS_PRODUCTION\) \{ toast\('Pro is not on sale yet'\); return; \}/, 'the checkout itself refuses on production too');
});

test('no browser file holds a Razorpay key or secret, and the app never asks for a price', () => {
  const pay = read('pay.js');
  assert.doesNotMatch(pay, /rzp_(test|live)_[A-Za-z0-9]{6,}/);
  assert.doesNotMatch(pay, /KEY_SECRET/);
  assert.doesNotMatch(pay, /amount:\s*\d/, 'the amount comes from the server order, never a literal');
  assert.match(pay, /key: order\.key_id/, 'the public key id comes from the server answer');
});

test('the success handler sends all three values to the server, and the browser never decides paid', () => {
  const pay = read('pay.js');
  for (const f of ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']) assert.match(pay, new RegExp('\\b' + f + '\\b'));
  assert.match(pay, /\/api\/verify-payment/);
  assert.match(pay, /payment\.failed/, 'a failed payment is handled');
  assert.match(pay, /ondismiss/, 'closing the window is handled');
});

test('each way the order can fail has a plain-words message that says nothing was charged where that is true', () => {
  assert.match(createOrderMessage(503), /not set up/);
  assert.match(createOrderMessage(401), /Nothing was charged/);
  assert.match(createOrderMessage(500), /Nothing was charged/);
  assert.match(createOrderMessage(400), /Nothing was charged/);
});

test('the secret and env files are kept out of git, with only an example committed', () => {
  const ig = read('.gitignore');
  assert.match(ig, /^\.env$/m);
  const ex = read('.env.example');
  assert.match(ex, /RAZORPAY_KEY_ID=\s*$/m);
  assert.match(ex, /RAZORPAY_KEY_SECRET=\s*$/m, 'the example has names only, no values');
});

// The plan comparison is where somebody decides, so the buy button lives in its footer - but only where a payment
// can really be taken. The live app still says Pro is not on sale, so it must not offer a purchase there.
test('the comparison footer offers Pro only where a payment can be taken, and never to a member', () => {
  const app = read('app.js');
  assert.match(app, /const canBuy = !IS_PRODUCTION && !isPaidPlan\(\);/);
  assert.match(app, /plan-compare-buy/);
  assert.match(app, /Get Pro/);
  assert.match(app, /startProCheckout/, 'the button starts the real checkout');
  // Close is always there; it is the primary button when there is nothing to buy.
  assert.match(app, /plan-compare-close/);
  assert.match(app, /'btn ' \+ \(canBuy \? 'ghost' : 'primary'\)/);
  assert.match(app, /Test mode: no real money is taken/, 'the price shown must not look like a real charge on staging');
});
