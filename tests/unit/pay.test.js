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

// Buying lives where somebody has just read what Pro adds, offering Monthly and Annual side by side.
// The Menu's lone "Buy Pro" row is gone: it could only ever start one of the two without saying which.
test('there is no buy row in the Menu, and the checkout still refuses on production', () => {
  const app = read('app.js');
  assert.equal(/menuItem\([^)]*Buy Pro/.test(app), false, 'the Menu must not sell');
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

// A 503 from create-order has two quite different causes. Saying "payments are not set up on this
// server" when the Razorpay keys are fine and it is the plan tables that are missing sends somebody
// looking for deleted environment variables - which is exactly what happened.
test('a missing plan table says so, rather than blaming the payment settings', () => {
  assert.match(createOrderMessage(503, 'plans_missing'), /Pro plans are not set up/);
  assert.match(createOrderMessage(503, 'plans_missing'), /Nothing was charged/);
  // No keys at all is still its own message.
  assert.match(createOrderMessage(503), /Payments are not set up/);
  assert.match(createOrderMessage(503, 'subscription_failed'), /Payments are not set up/);
  // The server has to send the reason for any of this to reach the app.
  const src = read('server/api/create-order.js');
  assert.match(src, /reason: 'plans_missing'/);
  assert.match(src, /ER_NO_SUCH_TABLE/, 'a missing table is told apart from any other failure');
  assert.match(read('pay.js'), /createOrderMessage\(created\.status, created\.json\.reason\)/);
});

// The Menu had a row that answered "what have I paid" and nothing that answered "what am I on, until
// when". Both now live behind the anonymous name at the top of the Menu, which is the label for this
// install and so the natural place to hang everything about it.
test('the Menu has no payments row, and the anonymous name opens the plan sheet instead', () => {
  const app = read('app.js');
  assert.equal(/menuItem\([^)]*Payment history/.test(app), false, 'no payments row in the Menu');
  const tag = app.slice(app.indexOf('const aliasTag ='), app.indexOf('if (deferredInstall)'));
  assert.match(tag, /openPaymentHistory\(\)/, 'tapping the name opens the sheet');
  const pay = read('pay-result.js');
  assert.match(pay, /planName = paid \? 'MyNotes Pro'/, 'the sheet is headed by the plan, not by the word history');
  assert.match(pay, /renewing === false \? 'Ends ' : 'Renews '/, 'a cancelled term must not claim it will renew');
});

// A receipt read months later is usually being read for one thing: how long it is good for.
test('the end of the term reaches the receipt, on screen, as text and in the drawn invoice', () => {
  assert.match(read('pay-result.js'), /rec\.until \? row\(/, 'the receipt shows it');
  assert.match(read('pay-core.js'), /rec\.until/, 'copied details carry it');
  assert.match(read('pay-invoice.js'), /rec\.until/, 'the drawn receipt carries it');
});
