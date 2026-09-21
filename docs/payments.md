# Payments: Razorpay Standard Checkout (test mode, staging only)

Status: built and unit-tested; **not live**. It runs on staging and local with Razorpay's **test** keys. Production has
no payment button and Pro is still "not on sale yet" everywhere the app says so. Written 21 Sep 2026.

## What it does
1. The app asks our server for an order: `POST /api/create-order { installId }`.
2. Razorpay's own checkout window opens with that order.
3. On success Razorpay returns three values; the app sends them, with the install id, to
   `POST /api/verify-payment`. The server checks the signature, asks Razorpay to confirm the order, and only then marks the
   install `paid`. The app re-checks its plan and flips to Pro.

## Files
| File | Job |
|---|---|
| `server/lib/razorpay.js` | Order request, signature check, confirmation. No SDK: two REST calls and `node:crypto`. |
| `server/api/create-order.js` | Step 1. Writes nothing to the database. |
| `server/api/verify-payment.js` | Step 3. The only place a payment can switch Pro on. |
| `server/lib/installs.js` `grantPaid` | Marks an install paid, creating a minimal row if the server has never seen it. |
| `pay.js`, `pay-core.js` | The browser side: load Razorpay's script, open the window, call verify. |
| `app.js` menu | "Buy Pro · test mode", shown only off production and only when not already Pro. |
| `.env.example` | The two variable names, with no values. |

## Decisions worth knowing
- **The price lives on the server** (`PRO_AMOUNT_PAISE`, 39900). The app never sends an amount, so nobody can pay less. A
  test keeps it equal to the price the app shows.
- **A payment is bound to one install.** The install id goes into the order's `notes` at creation and is read back from
  Razorpay at verification. Without this, one real payment could switch Pro on for any number of installs, because the
  signature covers only the order and payment ids.
- **The server confirms with Razorpay** that the order is `paid` for the Pro amount in INR. A valid signature alone is not
  enough.
- **Nothing is marked paid** on a signature mismatch, an unpaid or short order, a wrong currency, or another install's
  order: all return 400 and write nothing.
- **The secret never reaches the browser.** It is read from `RAZORPAY_KEY_SECRET` in the server environment only. The
  browser receives the public key id in the order answer, so there is no `NEXT_PUBLIC_` style variable: this project has
  no build step.
- **No new tables.** It reuses the existing `installs.plan`.
- **Not offered on production**, both in the menu and in `startProCheckout`, so the live app's "Pro is not on sale yet"
  wording (Privacy, Terms, comparison table) stays true.

## Setting it up on staging (manual)
1. In the **staging server project** on Vercel (`mynotes-server`): Settings > Environment Variables, add
   `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` with your `rzp_test_` pair. Redeploy.
2. **Regenerate the test secret first** if it was ever pasted into chat or a file. Then use the new one.
3. Never add these to the production project until purchases are meant to go live, and then with the `rzp_live_` pair.

## After the payment: result pages
`pay-result.js` shows a full-screen page for every outcome; `pay-core.js` holds the pure logic (tested in `tests/unit/pay-result.test.js`).
- **Success**: welcome with the local name, what unlocked, the Transaction ID and Order ID with Copy buttons, Save receipt
  (print sheet, Save as PDF), and a 10 s countdown into the guided plan setup (any tap stops it). Pro is switched on in the app
  only after this page is left (`applyDeferredPlan`), so the setup wizard never covers the receipt.
- **Failure**: title, plain message, and tips chosen from Razorpay's `reason`, then description, then `code`/`source`
  (cancelled, input, auth, declined, funds, expired, service, network, unknown). Try again (fresh order) or Cancel; Copy details for support.
- **Unconfirmed** (paid at Razorpay, our server could not confirm): says the money is safe, gives the reference, Check again. No retry, to avoid a double charge.
- Every attempt is kept on the device in `meta` key `payments` (max 30, not in backups); Menu > Payment history reopens them.

## Admin: Payments tab and refunds
`/admin` > **Payments** reads Razorpay live (`server/api/admin/payments.js`, logic in `server/lib/payments.js`): collected today,
net for 30 days (India time, after refunds), success rate, methods, failure reasons, and the newest payments. Payer email and phone are never copied out.
- **Refund** (whole or part) is a POST to the same endpoint. It is **refused unless `ADMIN_KEY` is set** on the server, because it moves real money.
  A full refund also switches that install back to Free (found from the order's `installId` note); a partial one leaves the plan alone.
- The admin is an installable app (`admin-*.webmanifest`, `admin-sw.js`). The manifest name is `MyNotes - Admin (staging)` unless the host is
  `api.viewsofvgm.com`. The in-page badge shows the environment and `ADMIN_VERSION`; bump it together with `ADMIN_CACHE` in `admin-sw.js` (a test checks they match).
- The API is at 12 serverless functions, the Vercel Hobby limit; a test fails if it grows past that, so new admin actions go into existing files.

## Testing it
Open the staging app (`mynote-app-tau.vercel.app`) on the Free Plan, Menu > **Buy Pro · test mode**.
Razorpay's test details: card `4111 1111 1111 1111`, any future expiry, any CVV, any name; for UPI use `success@razorpay`
(and `failure@razorpay` to see a failed payment). No real money moves in test mode. After a success the app should flip to Pro
without a reload, and the install shows as `paid` on the staging admin page.

Things to try: close the window (should say "Payment cancelled"), use the failure UPI id (should say "Payment failed"), and
turn the network off (should say payments need the internet).

## Not done yet
- **Webhooks.** Verification depends on the app reaching the server after payment. If the phone dies between paying and
  verifying, the payment succeeded but Pro is not switched on. A `payment.captured` webhook is the safety net, and is
  also how refunds and subscription renewals will arrive.
- **Subscriptions** (monthly and annual): a separate Razorpay product; see the earlier plan.
- **Restore purchase on a new phone**, refunds, and an admin Payments tab.
- **Google Play Billing** for the Android listing.
- The refund and cancellation policy page, and GST, which gateways and the Terms will need before going live.
