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
  assert.match(helper, /go\(period, price\)/, 'each button starts checkout for its own period');
  assert.match(helper, /if \(IS_PRODUCTION\) \{ toast\('Pro is coming soon/, 'production shows the price, and a tap only says it is coming soon');
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
  assert.match(read('pay-result.js'), /function termRow\(rec\) \{\s+if \(!rec\.until\) return null;/, 'the receipt shows it');
  assert.match(read('pay-core.js'), /rec\.until/, 'copied details carry it');
  assert.match(read('pay-invoice.js'), /rec\.until/, 'the drawn receipt carries it');
});

// The admin refund on the Payments tab: a real send needs one more explicit yes/no beyond the dialog
// itself (both money and, on a full refund with the box ticked, somebody's Pro plan are on the line),
// and - because the subscription-row lookup this session added is new and might not always find the
// install - the plain free/paid flag is now written unconditionally on every successful revoke, the
// same single write the Users tab's plan dropdown makes and is known to reach the app.
test('the admin refund confirms before sending, and always flips the flag directly on revoke', () => {
  const admin = read('server/public/admin.html');
  const submit = admin.slice(admin.indexOf("getElementById('refundYes').addEventListener"), admin.indexOf('// ---- Install as an app'));
  assert.match(submit, /if \(!confirm\(warn\)\) return;/, 'a real confirm, not just the dialog\'s own button');
  const handler = read('server/api/admin/payments.js');
  const from = handler.indexOf('revokePlan: async');
  const revoke = handler.slice(from, handler.indexOf('});', from) + 3);
  assert.match(revoke, /UPDATE subscriptions SET status = 'cancelled'/, 'the mandate itself is ended, not only the cached flag');
  // The unconditional write sits after the `if (subscriptionId)` block's own closing brace, not inside
  // it - a payment with no subscription id (the old one-time flow) must still reach this line.
  assert.ok(revoke.indexOf('if (subscriptionId)') < revoke.lastIndexOf('return setPlan'), 'the return comes after the if block, not nested in it');
});

// The Home banner for a term ending soon, and the popup at the moment it actually ends. Both read from
// the same place: app.js has no push notification to rely on, so a plan check that comes back with a
// notice is the only signal there ever is.
test('a term ending soon becomes a Home card; the plan actually ending becomes a popup, not a toast', () => {
  const app = read('app.js');
  assert.match(app, /export const _renewalBanner = \{ current: null, dismissedFor: /);
  const noticeFrom = app.indexOf("addEventListener('mynote-plan-notice'");
  const noticeListener = app.slice(noticeFrom, app.indexOf("applyAppMode('home');", noticeFrom));
  assert.match(noticeListener, /_renewalBanner\.current = \{ endsAt: n\.endsAt, cancelled: n\.state === 'ending', windowMs: /);
  assert.match(app, /function showPlanEndedModal\(forced\)/);
  assert.match(app, /Your data is safe - nothing has been changed or deleted/);
  assert.match(app, /text: 'Choose your ' \+ FREE_FEATURE_LIMIT \+ ' features'/);
  const planListener = app.slice(app.indexOf("addEventListener('mynote-plan',"), app.indexOf("addEventListener('mynote-plan-notice'"));
  assert.match(planListener, /showPlanEndedModal\(!_modsCache \|\| _modsCache\.size > FREE_FEATURE_LIMIT\)/);
  assert.equal(/toast\('Your Pro Plan has ended\. You are on the Free Plan\.'\)/.test(planListener), false, 'the old toast is gone, replaced by the popup');

  const ui = read('personal-ui.js');
  assert.match(ui, /function _homeRenewalCard\(\)/);
  assert.match(ui, /_homeRenewalCard\(\); if \(rc\) host\.appendChild\(rc\);/, 'wired into renderHome, ahead of Get Started');
});

// The billing test clock bug (v760): the local end-date check wrote Free silently, the server agreed,
// and "nothing changed" meant no popup; the reminder relied on a poll landing inside its window.
test('an ending term is noticed against what was shown, and both moments run on timers', () => {
  const src = read('sender.js');
  const fn = src.slice(src.indexOf('export async function checkPlan'), src.indexOf('export async function armPlanTimers'));
  assert.ok(fn.indexOf("DB.get('meta', 'plan')") < fn.indexOf('= await getCachedPlan()'), 'reads what was shown before correcting it');
  assert.match(fn, /resolvePlan\(shown, json\)/, 'compared against what was shown, not the corrected cache');
  assert.match(fn, /endedLocally\(\)/, 'offline and failed checks still raise the ended-plan popup');
  assert.match(fn, /remindAt: res\.plan === 'paid' \? local\(json\.remindAt\)/);
  assert.match(src, /export async function armPlanTimers\(\)/);
  const app = read('app.js');
  const at = app.lastIndexOf('armPlanTimers().catch');
  assert.ok(at > app.indexOf("addEventListener('mynote-plan-notice'"), 'armed only after the listeners exist');
  assert.match(app, /if \(document\.querySelector\('\.plan-ended'\)\) return;/, 'one popup, however many paths notice');
  assert.match(read('server/lib/installs.js'), /answer\.remindAt = /);
});

// Offline entitlement. Without this, a term that ran out while the phone had no signal would keep
// acting Pro right up until whenever the app next reached /api/plan - which could be days. `until` is
// what the server itself told us on the last successful check, so enforcing it locally between syncs
// is the same thing any app store subscription client does with its own cached receipt.
test('a cached plan enforces its own end date offline, and corrects storage so it only fires once', () => {
  const src = read('sender.js');
  const fn = src.slice(src.indexOf('export async function getCachedPlan'), src.indexOf('export async function getPlanDetail'));
  assert.match(fn, /r\.value\.until && new Date\(r\.value\.until\)\.getTime\(\) <= Date\.now\(\)/, 'checked against the cached end date, no network involved');
  assert.match(fn, /DB\.put\('meta', \{ key: 'plan', value: \{ \.\.\.r\.value, plan: 'free', endedAt: r\.value\.until \} \}\)/, 'the correction is written back (with when it ended), not just returned');
});

// The startup counterpart: the correction above can happen with the app never online at all, so it has
// to run through the same event the server-confirmed path uses - toast, the "nothing was deleted" popup,
// being sent to choose features - rather than silently downgrading the badge and nothing else.
test('an offline expiry at startup still gets the full ended-plan treatment, not a silent downgrade', () => {
  const app = read('app.js');
  const init = app.slice(app.indexOf('const _rawPlanBefore ='), app.indexOf("applyAppMode('home');", app.indexOf('const _rawPlanBefore =')));
  assert.match(init, /_wasStoredPaid = !!\(_rawPlanBefore && _rawPlanBefore\.value && _rawPlanBefore\.value\.plan === 'paid'\)/);
  assert.match(init, /if \(_wasStoredPaid && document\.body\.dataset\.plan !== 'paid'\) \{/);
  assert.match(init, /detail: \{ plan: 'free', wasPaid: true \}/, 'the true prior state travels with the event, since dataset.plan was already corrected before any listener existed');
  // And the listener has to actually honour that override rather than re-deriving it from the (already
  // corrected) badge, which would silently read "free" and skip the popup.
  assert.match(app, /e\.detail && typeof e\.detail\.wasPaid === 'boolean' \? e\.detail\.wasPaid : document\.body\.dataset\.plan === 'paid'/);
});

// v763: the reminder and the ended popup used to vanish behind the guided setup and payment pages.
test('plan news is never dropped or hidden behind the guided setup or a receipt', () => {
  const app = read('app.js');
  const planL = app.slice(app.indexOf("addEventListener('mynote-plan',"), app.indexOf("addEventListener('mynote-plan-notice'"));
  assert.equal(/!document\.querySelector\('\.onboard'\)\) \{\s+showPlanEndedModal/.test(planL), false, 'the guided setup no longer suppresses the popup');
  assert.match(planL, /whenClear\(\(\) => showPlanEndedModal\(/);
  assert.match(planL, /if \(plan !== 'paid'\) _deferredPlan = null;/, 'Pro going off never waits for a page');
  assert.match(planL, /if \(plan === 'paid'\) armPlanTimers\(\)/, 'a due reminder re-fires after Pro comes on');
  const nFrom = app.indexOf("addEventListener('mynote-plan-notice'");
  const noticeL = app.slice(nFrom, app.indexOf("addEventListener('mynote-pay-closed', (e)", nFrom));
  assert.equal(/if \(!n \|\| document\.querySelector\('\.pay-page'\)\) return;/.test(noticeL), false, 'not dropped while a page is open');
  assert.match(noticeL, /mountRenewalCard\(\);/);
  assert.match(app, /\$\('#modalHost'\)\.classList\.add\('modal-top'\);/);
  assert.match(app, /host\.classList\.remove\('modal-top'\);/, 'closeModal drops the raised layer');
  assert.match(app, /\.onboard:not\(\.ps-root\)/, 'waits only for the first-run welcome, not the plan setup');
  assert.match(read('styles.css'), /body\.locked \.modal-host\.modal-top \{ z-index: 10100; \}/, 'above the guided setup, payment pages and the update bar');
  assert.match(read('pay-result.js'), /mynote-pay-closed/);
  assert.match(read('sender.js'), /wasPaid: shown === 'paid'/);
});

test('countdowns and end-date comparisons', async () => {
  const { countdownText, sameMoment } = await import('../../pay-core.js');
  assert.equal(countdownText(0), '');
  assert.equal(countdownText(-5), '');
  assert.equal(countdownText(65 * 1000), 'in 1:05');
  assert.equal(countdownText(59 * 60 * 1000 + 59 * 1000), 'in 59:59');
  assert.equal(countdownText(2 * 3600e3 + 5 * 60e3), 'in 2h 05m');
  assert.equal(countdownText(86400e3), 'in 1 day');
  assert.equal(countdownText(29 * 86400e3 + 5), 'in 29 days');
  assert.equal(sameMoment('2026-09-23T11:21:00.100Z', '2026-09-23T11:21:00.900Z'), true, 'a plan check apart is the same term');
  assert.equal(sameMoment('2026-09-23T11:21:00Z', '2026-09-23T11:26:00Z'), false);
  assert.equal(sameMoment(null, '2026-09-23T11:21:00Z'), false);
});


// v764: the account sheet says only "Pro expired <when>"; countdowns show near the end, not all term long.
test('countdown windows, the account band, and the card that slides in and out', async () => {
  const { countdownWindowMs } = await import('../../pay-core.js');
  assert.equal(countdownWindowMs(5 * 60e3), 60e3, 'a 5-minute test month: the last minute');
  assert.equal(countdownWindowMs(90e3), 60e3);
  assert.equal(countdownWindowMs(2 * 3600e3), 5 * 60e3, 'a 2-hour test year: the last five minutes');
  assert.equal(countdownWindowMs(null), 5 * 60e3, 'real time: the last five minutes');
  const pr = read('pay-result.js');
  assert.equal(/Pro expired[^\n]*any 5 features free/.test(pr), false, 'the expired line stands alone');
  assert.match(pr, /within: countdownWindowMs\(termMs\)/);
  assert.match(pr, /\[status, count, nameTag\]/, 'status, then the countdown, then the name');
  assert.match(read('server/lib/installs.js'), /answer\.termMs = testSpanMs\(ent\.period, clock\);/);
  assert.match(read('server/api/verify-payment.js'), /termMs: c\.enabled \? testSpanMs\(r\.period, c\) : null/);
  const ui = read('personal-ui.js');
  assert.match(ui, /function _enterRenewalCard\(wrap\)/);
  assert.match(ui, /function _leaveRenewalCard\(wrap\)/);
  assert.match(ui, /onEnd: \(\) => _leaveRenewalCard\(wrap\)/, 'the card leaves by itself when the term ends');
  const css = read('styles.css');
  assert.match(css, /\.home-renew-wrap\.is-in \{ grid-template-rows: 1fr;/);
  assert.match(css, /\.live-countdown\[hidden\] \{ display: none !important; \}/);
  assert.equal(/\.home-renew \{ display: flex; align-items: center; justify-content: space-between/.test(css), false, 'the old card rules are gone');
});

// v769: closing the reminder card hides it until the app is closed; reopening shows it again.
test('a closed reminder card comes back the next time the app is opened', () => {
  const app = read('app.js');
  assert.match(app, /export const _renewalBanner = \{ current: null, dismissedFor: null \};/, 'nothing carried over from last time');
  assert.match(app, /localStorage\.removeItem\('mynote-renew-dismissed'\)/, 'the old saved dismissal is cleared');
  assert.equal(/localStorage\.setItem\('mynote-renew-dismissed'/.test(read('personal-ui.js')), false, 'closing it is not saved');
});

// v770: the ended popup lists the features kept on Free, with Renew Pro and Close.
test('the ended popup lists the Free features kept, offers renewal, and closes onto them', () => {
  const app = read('app.js');
  const fn = app.slice(app.indexOf('function showPlanEndedModal('), app.indexOf('export function menuItem('));
  assert.match(fn, /APP_MODULES\.filter\(\(m\) => modOn\(_modsCache, m\.id\)\)/, 'the saved Free choice, as the app now shows it');
  assert.match(fn, /'Your Free Plan features'/);
  assert.match(fn, /_buyPeriodButtons\(closeModal\)/, 'renew Monthly or Annual');
  assert.match(fn, /const canBuy = !IS_PRODUCTION;/, 'never offered where a payment cannot be taken');
  assert.match(fn, /text: 'Close', onclick: closeModal/);
});

// v773: "Your Pro Plan renews soon" showed twice - a reminder mounted into a Home that was mid-redraw, then
// renderHome added its own; overlapping redraws both filled Home; and a toast repeated the card's words.
test('the renewal reminder shows once on Home', () => {
  const ui = read('personal-ui.js');
  const mount = ui.slice(ui.indexOf('export function mountRenewalCard'), ui.indexOf('function _enterRenewalCard'));
  assert.match(mount, /if \(!host\.querySelector\('\.home-hero'\)\) return;/, 'never into a Home being drawn');
  const home = ui.slice(ui.indexOf('export async function renderHome'), ui.indexOf('function _homeFabClearance'));
  assert.match(ui, /const gen = \+\+_homeGen;/);
  assert.ok((home.match(/if \(stale\(\)\) return;/g) || []).length >= 8, 'an overtaken redraw stops after each await');
  assert.match(home, /\.home-renew-wrap:not\(\.is-leaving\)'\)\]\.slice\(1\)\.forEach\(\(w\) => w\.remove\(\)\);\s+mountRenewalCard\(\);/);
  const app = read('app.js');
  const nFrom = app.indexOf("addEventListener('mynote-plan-notice'");
  const noticeL = app.slice(nFrom, app.indexOf("addEventListener('mynote-pay-closed', (e)", nFrom));
  assert.match(noticeL, /if \(state\.appMode === 'home' && !overHome\) return;\s+planToast\(renewalMessage/, 'no toast on top of the card');
});
