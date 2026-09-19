# Server phase

Written 2026-09-19. **Deployed and verified 2026-09-19** as the Vercel project `mynotes-server` (https://mynotes-server.vercel.app) on a TiDB Cloud Starter instance (`mynotes01`, Singapore, database `mynotes`, spending limit $0). Verified live from the real app origin (https://mynote-app-tau.vercel.app): `/api/health` ok; `POST /api/collect` 204 (with and without age/gender); an extra `amount` field and the "Under 18" band rejected with 400; `POST /api/forget` 204; CORS header present for the app origin and `http://localhost` and absent for unknown origins. Vercel's Hobby "rate limited, retry in 24 hours" block on deployments (hit around 13:40 IST after ~100 deployments in a day) cleared within about an hour, sooner than the message said. Still open: set the Vercel function region to `sin1` (calls still run in `iad1`, far from the database), and the app-side sender is not built yet.

## Objectives (from the owner)
1. Free of cost at the initial stage.
2. Open-source, MySQL-compatible database, reachable from Vercel.
3. A written capacity calibration.
4. Migration to a bigger database later with **no data loss**.

## What the server does
Receives anonymous usage counts (`POST /api/collect`), deletes one install's data on request (`POST /api/forget`), and answers a health check. It stores only: install id, features switched on, plan, app version, platform, time zone, language, and (only if the user gave them) age band and gender. It rejects any other field, never reads or logs IPs, never stores request bodies (it reads only the `Origin` and `Content-Length` headers), and never sees money data. See `server/README.md` for setup.

## Choices
- **Database:** TiDB Cloud Starter (open source, MySQL-compatible, free: 5 GiB, 50M request units a month, 400 connections, Vercel integration). Fallback: Aiven free MySQL (real MySQL, 1 GB, powers off when idle). PlanetScale's free plan is gone.
- **Endpoint:** Vercel functions (serverless), Root Directory `server`.
- **Portability rules:** plain standard MySQL only; schema in numbered `server/schema/*.sql` files (never edit an applied one); connection string only in `DATABASE_URL`; the three `api/` files stay thin with logic in `lib/`.

## Capacity calibration (an estimate, not a measurement)
Assumes about 4 requests per install per month and about 20 request units per request (conservative).

| Limit | Ceiling | Installs supported |
|---|---|---|
| TiDB request units | 50M / 20 = 2.5M requests a month | about 600,000 |
| Vercel Hobby invocations | 1M a month | about 250,000 (first limit hit) |
| TiDB storage | about 1 KB per install, 5 GiB | about 5 million |
| If real cost is 10x worse | | about 25,000 installs free, then pennies |

Real load: 100,000 installs is about 400,000 requests a month, one every 6 seconds. Requests almost never overlap.

## Cons and action plan
Status: **done** = in the code, **todo** = to build, **you** = an action for the owner.

| Con | Action | Status |
|---|---|---|
| Cold starts | The app sends in the background with a short timeout and never waits | todo (with the sender) |
| Too many connections | Pool capped at 3 per function copy (waiting requests queue, they are not dropped). Add one retry on a dropped connection | cap done, retry todo |
| Vercel Hobby limit, 1M invocations a month | Send only on first run, on feature change and about weekly. Server skips a repeat write within about 6 hours. Move to Pro at about 200,000 installs or when revenue starts. Check the Vercel usage page monthly | todo; check = you |
| Hobby is non-commercial | Stay on Hobby only while the app earns nothing. Upgrade to Pro (about $20 a month) before the paid tier launches | you |
| Lock-in to Vercel's file layout | Keep `api/` files thin; logic is in `lib/`. Leaving means rewriting only those files | done |
| No cron or background jobs | Run `npm run export` on a schedule with a free GitHub Actions cron, saved privately (the dump holds install ids and demographics, so never public) | todo |
| Vercel keeps its own request logs | Add "our hosting provider may keep short-lived standard logs" to the Privacy text before launch; no logging in our code; check Vercel log settings | text todo; code done |
| TiDB is not real MySQL | Standard MySQL only; test-restore an export on a plain MySQL host once | rule done; test-restore todo |
| Idle connections dropped after 30 minutes | Small pool, keep-alive, retry once | keep-alive done, retry todo |
| Quota exhausted, TiDB refuses connections | Sender ignores failures and retries at the next app open or weekly send. Set a TiDB monthly spending limit. Keep a second free instance in reserve | sender todo; limit = you |
| Free backups: 1 day, no point-in-time restore | Weekly export via GitHub Actions, keep the last several files, manual export before any change | script done, schedule todo |
| Nobody watching if it goes down | Free uptime monitor (for example UptimeRobot) on `/api/health` with an email alert | you |
| Abuse or spam | 2 KB payload cap and strict allow-list are done. Add a per-install throttle, and Vercel rate limiting if needed | throttle todo |
| No changefeed or Data Migration on free TiDB | Not needed: dump and restore covers moves between hosts | nothing |

**Why a failed request loses nothing:** each request is a full snapshot written as an upsert, so the next successful send brings the server fully up to date. The sender can ignore failures safely.

## The app-side sender (built 2026-09-19, v602; OFF for everyone)
Files: `usage-core.js` (pure rules), `sender.js` (network), wired in `app.js`.

**What is sent** (POST /api/collect; the server rejects anything else): `v`, `installId` (random, made on first run), `features` (the features switched on), `plan`, `appVersion`, `platform` (android/ios/windows/mac/linux/other), `timeZone`, `language`, and only if the person shared them, `ageBand` and `gender`. **Never:** amounts, holdings, expenses, notes, name, contact details, vault data, IP (the server does not read it).

**When:** first time after features are chosen, whenever the message changes (features, age group, gender, app version), and about weekly. Not more than once per identical state; after a failure it waits 10 minutes. Silent on every error. Never when the anonymous-counts switch is off. Turning the switch off, or Menu > Clear all data, sends POST /api/forget so the server deletes that install's rows (retried on the next open if it fails).

**Switch:** `USAGE_ENABLED` in `sender.js` is `false`, so nobody sends anything, because the Privacy Policy says "Not active yet". For your own testing only: in the browser console run `localStorage.mynoteUsageTest = '1'` and reload.

**Check in the app:** Menu > Privacy & Terms > Privacy Policy > "Show what MyNotes would send" shows the exact message and whether sending is active, off, or when it was last sent.

**Check in the database** (TiDB SQL Editor):
```sql
SELECT * FROM mynotes.installs ORDER BY last_seen DESC LIMIT 20;
SELECT feature, COUNT(*) AS installs FROM mynotes.install_features GROUP BY feature ORDER BY installs DESC;
SELECT age_band, gender, COUNT(*) AS n FROM mynotes.installs GROUP BY age_band, gender;
SELECT COUNT(*) AS total_installs FROM mynotes.installs;
```

**To go live (all in one change, then one push):**
1. Lawyer review of the analytics wording (default-on counts; EU users need consent).
2. In `legal-text.js` remove "Not active yet" and state the start date (a unit test fails if this and the switch disagree).
3. Set `USAGE_ENABLED = true` in `sender.js`.
4. Confirm `ALLOWED_ORIGINS` on the server lists the live app origin.
5. Bump the version, run all tests, push, and check the first rows arrive.

## Migrating to a bigger database
1. `npm run export` to take a data export (`backups/mynotes-YYYY-MM-DD.sql`).
2. Point `DATABASE_URL` at the new database and run `npm run migrate` (creates the tables).
3. Load the export with any MySQL client.
4. Change `DATABASE_URL` in Vercel.

## Reminders (raise these when server work resumes, and before launch)
- [ ] **Before deploying:** create the TiDB instance, set a spending limit, set `DATABASE_URL` and `ALLOWED_ORIGINS`, run `npm run migrate`, check `/api/health`.
- [x] App-side sender built and tested (v602, switched off).
- [ ] **Before launch:** flip the sender on (steps above); add the hosting-logs sentence to the Privacy text; lawyer review of the analytics wording; add the uptime monitor; schedule the weekly export.
- [ ] **Before the paid tier:** move Vercel from Hobby to Pro.
- [ ] **Monthly:** check Vercel invocations and TiDB request units against the ceilings above.
- [ ] **Once:** test-restore an export on a plain MySQL host to prove the migration path.
- [ ] **Periodically:** re-check TiDB's free-tier terms (free tiers change; PlanetScale removed its own in 2024). If they worsen, use the migration steps above.

## Domain, payments, email (researched 2026-09-19; confirm prices before buying)
- **Domain on Vercel:** sold at the registrar's own price with no markup; the free first-year domain on Pro covers only .app/.dev/.online/.site/.space/.store/.tech/.website, not .com or .in. Look up the exact price in the search box at vercel.com/domains. A domain is not locked to Vercel; it can be transferred out. Needed anyway for the privacy-policy URL on Play and for Android packaging.
- **Vercel does not sell payments, SMS or email itself.** Its Marketplace connects Stripe, Twilio and Resend, and you pay those providers directly.
- **Email for invoices:** Resend free = 3,000/month and 100/day; Brevo free = 300/day; Amazon SES = $0.10 per 1,000 (about $1.15 per 10,000 with extras). Free tiers cover early volumes.
- **Payments in India:** Razorpay charges about 2% + 18% GST on that fee (about 2.36%) on cards and UPI; it advertises 0% platform fee for merchants activating on or after 1 July 2026 (verify).
- **Play Store rule:** an Android app on Google Play that sells digital features must use Google Play Billing (India also allows alternative billing, with a 4% fee reduction). Roughly 15% service fee at first; India stays on the current structure until 30 September 2027. Play sends the buyer's receipt itself, so the Play version needs no invoice email from us.
- **SMS:** not needed; the app collects no phone numbers. (India SMS needs DLT registration if ever added.)
- **Privacy impact:** invoicing by email means holding an email address, which today's Privacy text says we never collect. Update the text before paid launch; for Play purchases Google holds the email, for Razorpay purchases Razorpay does.
- **Tax:** GST registration and invoice rules depend on turnover; check with a CA before the paid tier.
