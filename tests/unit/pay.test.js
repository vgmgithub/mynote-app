import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrderMessage } from '../../pay-core.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('the subscription prices the app shows are the prices seeded on the server', () => {
  const seed = read('server/schema/006_subscriptions.sql');
  const compare = read('plan-compare.js');
  const monthly = /MONTHLY_PAISE = (\d+)/.exec(compare);
  const annual = /ANNUAL_PAISE = (\d+)/.exec(compare);
  assert.ok(monthly && annual, 'the app states both prices');
  assert.match(seed, new RegExp("'pro', 'monthly',\\s+" + monthly[1]));
  assert.match(seed, new RegExp("'pro', 'annual',\\s+" + annual[1]));
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
  assert.doesNotMatch(pay, /amount:\s*\d/, 'the amount comes from the server, never a literal');
  assert.match(pay, /key: sub\.key_id/, 'the public key id comes from the server answer');
  // The mandate's amount and currency live on the Razorpay Plan behind it, so the checkout constructor
  // itself never sets one - only the subscription id.
  assert.match(pay, /subscription_id: sub\.subscription_id/);
  assert.doesNotMatch(pay, /new window\.Razorpay\(\{[^}]*amount:/s);
});

test('the success handler sends all three subscription values to the server, and the browser never decides paid', () => {
  const pay = read('pay.js');
  for (const f of ['razorpay_subscription_id', 'razorpay_payment_id', 'razorpay_signature']) assert.match(pay, new RegExp('\\b' + f + '\\b'));
  assert.match(pay, /\/api\/verify-payment/);
  assert.match(pay, /payment\.failed/, 'a failed payment is handled');
  assert.match(pay, /ondismiss/, 'closing the window is handled');
});

test('checkout asks for a period, and defaults to the same one the server defaults to', () => {
  const pay = read('pay.js');
  assert.match(pay, /export async function startProCheckout\(period = 'annual'\)/);
  assert.match(pay, /installId, period/, 'the period travels to create-order');
  assert.match(pay, /if \(retry\) startProCheckout\(period\)/, 'a retry keeps the period the person chose');
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
test('the comparison footer offers Monthly and Annual only where a payment can be taken, and never to a member', () => {
  const app = read('app.js');
  assert.match(app, /const canBuy = !IS_PRODUCTION && !isPaidPlan\(\);/);
  assert.match(app, /_buyPeriodButtons\(closeModal\)/, 'the shared Monthly\/Annual row is used, not a one-off button');
  assert.match(app, /plan-compare-buy/);
  assert.match(app, /startProCheckout\(period\)/, 'the button starts the real checkout, for the period it names');
  // Close is always there; it is the primary button when there is nothing to buy.
  assert.match(app, /plan-compare-close/);
  assert.match(app, /'btn ' \+ \(canBuy \? 'ghost' : 'primary'\)/);
  assert.match(app, /Test mode: no real money is taken/, 'the price shown must not look like a real charge on staging');
});

test('the two buy buttons are priced from one shared place, and Annual says what it saves', () => {
  const app = read('app.js');
  const helper = app.slice(app.indexOf('function _buyPeriodButtons'), app.indexOf('function showProInfo'));
  assert.match(helper, /btn\('monthly', 'Monthly', MONTHLY_PRICE\)/);
  assert.match(helper, /btn\('annual', 'Annual', ANNUAL_PRICE, 'save ' \+ ANNUAL_SAVE_PCT \+ '%'\)/);
  assert.match(helper, /go\(period\)/, 'each button starts checkout for its own period');
});
