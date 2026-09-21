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
