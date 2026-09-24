# Beta Plan: a 6-week feedback cohort, free access for genuine weekly feedback

Status: **designed, not built**. Nothing in this doc exists in code yet. Written 24 Sep 2026 as the reference to build
from — see "Phasing" for the order it should actually get built in.

## Summary

Anyone can request Beta from the side Menu. An admin approves each request by hand — including every re-request
after a termination, never automatic. Once approved, the person gets every MyNotes feature unlocked, free, with a
green Beta badge, for as long as the current 6-week cohort runs. In exchange they submit a short feedback form every
week (opens Friday, closes Sunday 23:59, device-local time) — missing a week, or an admin judging a submission not
genuine, ends their Beta and reverts them to Free, exactly like an expired Pro subscription today: nothing deleted,
they just re-pick 5 free features. At the cohort's end, every answer in every submission is rated by hand and rolled
into a per-person contribution score; the top 10% become **Beta Contributors** (₹199/year, locked for every future
renewal), everyone else who completed Beta becomes a **Beta Member** (₹299/year, available for one year) — both a
purely optional purchase, never automatic.

Nothing about the core privacy guarantee changes: a Beta user's financial data never reaches the server, on any
plan. The only new things this feature ever sends are the weekly feedback text/answers and the same anonymous
usage/feature analytics every user already sends today.

## What it does

1. Menu → "Request Beta" opens a detail page explaining the deal (free, full access, weekly feedback required, read
   `context.md`'s privacy guarantee). Tapping Request needs to be online; it creates a pending request.
2. Admin reviews pending requests in the dashboard and approves or rejects. Approval sets the install's plan to
   `beta` and joins it to the current cohort.
3. While `beta`: every feature is unlocked (same as Pro), the Home title icon and Menu show the green Beta badge,
   and a Home reminder appears Friday through Sunday if that week's form isn't submitted yet.
4. The weekly form can be opened and filled out offline; Submit needs connectivity (blocked with a message
   otherwise, same as every other online-required action in this app).
5. Two ways Beta ends, both revert to Free through the existing "Pro Plan has ended" flow (no data touched, re-pick
   5 features): (a) a week's window closes with no submission — automatic, caught by a daily server check; (b) an
   admin reads a submission and judges it not genuine — a manual call, made from the dashboard.
6. When the cohort's `end_date` arrives, every answer in every submission gets an admin rating. Scores roll up per
   person; the top 10% of everyone ever approved into the cohort become Beta Contributors, everyone else who
   completed Beta becomes a Beta Member. Both get a one-year window to buy Pro at their tier's locked price —
   whenever they like, the subscription itself always runs a full year from whenever they actually buy.

## Free / Beta / Pro

| | Free | Beta | Pro |
|---|---|---|---|
| Price | Free | Free (invite/approval only) | ₹49/mo or ₹399/yr |
| Features | Any 5, switchable | All, for the cohort's duration | All |
| Badge | — | Green, "Beta" | Gold, "Pro" star |
| Obligation | None | A feedback form every week | None |
| Ends | — | Missed week (auto) or "not genuine" (admin) → back to Free | Subscription lapses → back to Free |
| Backup restore on a new device | n/a | Never carries Beta — re-verified per device, like Pro today | Never carries Pro — re-verified per device |
| After it ends | — | A one-year window to buy Pro at ₹299 (Member) or ₹199-for-life (Contributor) | Buy again anytime at the standing price |

## The weekly form

Fixed multiple-choice questions (exact wording TBD), plus a comment box: a heading chosen from a predefined list or
a typed custom one, and the comment body. **Every field is required** — validated the same way the rest of the app
validates a single-shot form (`markMissing` + `toast`, see `expense-ui.js`/`personal-ui.js`), not the multi-step
wizard pattern. One submission per person per window (`week_start` + `install_id` unique).

## Rules for termination (standing)

- **Missed a window**: automatic. A daily server check (see Phase 1) finds no submission for the window that just
  closed and flips the install back to Free. No admin step, no judgment call — a submission either exists or it
  doesn't.
- **Not genuine**: an admin's call, made after reading the submission, never automatic.
- **Either way**: the person's own data is completely untouched. Only the feature-access level changes — same
  contract this app already has for an expired Pro subscription.
- **Re-entry is never automatic.** A person terminated for either reason has to submit a fresh request, and an admin
  has to approve it again, exactly like the first time.

## Phasing

Three independently shippable pieces. Each leaves the app fully working if the next one is delayed.

### Phase 1 — Beta core: request → approve → weekly feedback → terminate

**Plan modeling, minimal blast radius.** `installs.plan` (`VARCHAR(8)`, no CHECK constraint —
`server/schema/001_init.sql:10`) and the client's `meta.plan`/`document.body.dataset.plan` gain a real third value,
`'beta'` — `server/lib/validate.js:6` `PLANS` becomes `['free', 'paid', 'beta']`. Every existing feature gate stays
untouched by redefining the one shared helper rather than its ~9 call sites: `isPaidPlan()` (`app.js:2048`,
duplicated `health.js:1149`) becomes `plan === 'paid' || plan === 'beta'` — Beta unlocks everything Pro does, with
zero changes to `feed-ui.js`, `mf-ui.js`, `metals-ui.js`, `plan-setup-ui.js`, `pay.js`, `feature-limit.js`,
`personal-ui.js`. A new `isBetaPlan()` (`plan === 'beta'`) covers only the places that must look different: badge,
Menu row, the weekly nag, the admin plan dropdown. `meta.plan` stays in `DEVICE_ONLY_META` (`db.js:15`) exactly as
today — Beta, like Pro, is re-verified per device and never travels in a backup restore.

The existing rank-ladder subscription tables (`server/schema/006_subscriptions.sql`) are **not** used for Beta
itself — that machinery is for real Razorpay subscriptions with periods and pricing, and Beta has neither. Folding a
free, hand-granted tier into it would be overengineering; `installs.plan = 'beta'` (parallel to how `'paid'` already
works via `setPlan()`/`grantPaid()` in `installs.js`) is the right-sized fit.

**Icon.** A supplied piggy-bank + flask "BETA" illustration (mint-green rounded square, matching `icon-free.png` /
`icon-pro.png`'s existing style) saved as `icons/icon-beta.png`. Used for the Menu row, the Beta detail/status page,
and a third branch wherever the app currently does a binary free/pro icon swap — `app.js:2134`, `app.js:2462`
(onboarding logo), `personal-ui.js:2793-2797` (Home title icon) — keyed off the plan string directly
(`{free: 'icon-free.png', paid: 'icon-pro.png', beta: 'icon-beta.png'}`). It reverts to free/pro automatically once
Beta ends, since these are just re-renders of whatever `isPaidPlan()`/`isBetaPlan()` resolve to next.

**Offline-capable weekly window**, device-local clock (a user could spoof it by changing their phone's clock — a
low-value attack for a single-owner beta program, and the same trust model this app already places in the device
clock for Pro-expiry). Stored as `meta.betaFeedback = { lastSubmittedWeek: 'YYYY-MM-DD' }` (the window's Friday).
Computed with zero network, checked on every app open/foreground:

```js
function currentWindow(now = new Date()) {
  const daysSinceFriday = (now.getDay() - 5 + 7) % 7;      // Fri = 5
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(now.getDate() - daysSinceFriday);
  const end = new Date(start); end.setDate(start.getDate() + 2); end.setHours(23, 59, 59, 999);
  return { weekKey: isoDate(start), start, end, isOpen: now >= start && now <= end };
}
```

If open and not yet submitted this week: a persistent Home reminder (styled like the existing renewal card, not a
blocking modal), re-armed by a plain `setTimeout` at the next Friday/Monday boundary — the window recurs weekly, so
none of `armPlanTimers`'s ~24.8-day chunking (`sender.js:240-258`, needed only for year-long subscription terms)
applies here. The client **never self-reverts** — it only shows the reminder and gates the Submit button on
`navigator.onLine` (blocked with a toast otherwise, the same pattern `checkPlan()`/`sendUsage()` already use for
online-required actions in `sender.js`). Enforcement is server-authoritative, so the existing `checkPlan()` poll
(already run on every app open) and the existing `mynote-plan-notice` → `showPlanEndedModal` path pick up a
server-driven revert automatically — no new client popup code.

**Where the automatic revert executes — server cron.** A new entry alongside the existing two in
`server/vercel.json` (`crons`), same pattern as `server/lib/cron.js` / `server/api/cron-news.js`, running once daily
in IST (this app's user base is India-based — `docs/context.md`), comfortably after Sunday 23:59 IST everywhere
real. It sweeps every `installs.plan = 'beta'` row; if no `beta_feedback` row exists for the most recently closed
window, it flips that install to `'free'` through the existing plan-change primitive and records
`beta_terminated_reason = 'missed_week'` for the admin dashboard.

**Data model** (new migration, `server/schema/007_beta.sql`):

| Table / column | Purpose |
|---|---|
| `beta_cohort(id, start_date, end_date, label)` | The current 6-week run. Admin-set dates, never hardcoded in code. |
| `beta_requests(id, install_id, status ENUM('pending','approved','rejected'), requested_at, reviewed_at, reviewed_note)` | One row per request. A re-request after termination is a new row, never reactivated. |
| `beta_feedback(id, install_id, cohort_id, week_start DATE, submitted_at, comment_title, comment_body, reviewed BOOLEAN, total_score)` | One row per weekly submission. Unique on `(install_id, week_start)`. |
| `installs.beta_terminated_reason VARCHAR(20) NULL` | `'missed_week'` or `'not_genuine'`, cleared on a fresh approval. |

**New endpoints** (`server/api/`, validated via `validate.js`-style allow-lists): `POST /api/beta/request`,
`POST /api/beta/feedback` (re-validates the window server-side too, in IST, as defense against a stale cached
form), plus admin approve/reject/terminate actions extending `server/api/admin/*.js`. **Admin UI**: a new "Beta"
section in `server/public/admin.html`, mirroring the existing Users/Payments tab card patterns.

### Phase 2 — Scoring + anonymous leaderboard

**Cohort, not open-ended.** The original framing ("no fixed program length") was corrected during design: Beta runs
as a single admin-configured window — `beta_cohort.start_date`/`end_date` hold the real dates, set by the admin (6
weeks for this run), never a hardcoded duration in the app. Anyone approved joins the *current* cohort; everyone in
it shares the same `end_date`, which is what makes ranking well-defined — there's no staggered per-person timing to
reconcile, the whole cohort is scored together when it ends.

**Per-answer scoring, not per-submission.** Each weekly submission is one `beta_feedback` row plus one
`beta_feedback_answers` row per question answered (`feedback_id`, `question_key`, `answer_value`,
`score SMALLINT NULL`, `admin_note TEXT NULL`) — the admin rates **each answer individually** (answer five
questions, get five individual ratings), not one holistic rating per week. A submission's `total_score` is a
computed roll-up of its answers' scores; a person's overall contribution score is a roll-up of all their
submissions across the cohort. **The exact roll-up formula and rating dimensions are intentionally left open** —
the owner will finalize the rubric later; this data model's only job is to capture true per-answer granularity so
any formula can be applied, and re-applied via an admin "recalculate" action, without a schema change.

**Leaderboard pool, ranking, reward tier**:
- Pool = every install ever approved into the cohort (not just those still active — the pool only grows, so a
  computed rank is never invalidated by someone leaving later).
- At `end_date`: `winners = max(1, floor(pool_size × 0.10))`. The top `winners` by contribution score become **Beta
  Contributor**; everyone else who completed Beta (wasn't terminated) becomes **Beta Member**.
- Tie-break at the cutoff: higher average "Product Impact" score, then earliest first-submission timestamp — fully
  deterministic, never re-runs differently. (This assumes the eventually-finalized rubric keeps a dimension
  equivalent to "Product Impact"; flagged, not blocking.)
- Anonymous display: the existing alias system (`alias.js` — a fabricated, pronounceable, server-confirmed-unique
  handle like `@Meharika`, already sent with every usage ping), reused as-is rather than minting a second identity
  system. Worth noting explicitly: today that alias is shown only to its own owner; a shared leaderboard is the
  first time one install's alias becomes visible to *other* installs. Still zero PII, but a new exposure.
- Admin can re-run the ranking calculation at any time up to and at cohort close, so ratings can be worked through
  gradually rather than needing to land all at once.

### Phase 3 — Post-Beta conversion pricing

Reuses the existing subscription architecture directly — this needs **no new renewal logic at all**, confirmed by
how renewals already work: a subscription's `amount` is frozen once, at signup, from whichever `plan_prices` row was
active that moment (`server/lib/razorpay-subs.js:144-146`); renewals are charged by Razorpay itself against the
fixed Razorpay Plan the subscription is bound to, and `server/lib/webhook.js:44-72` only ever extends
`current_end` — it never re-prices anything. The schema's own comment already anticipates this
(`006_subscriptions.sql:8-9`): *"a NEW PLAN is an INSERT into `plans`, not a schema change."*

- Two new `plan_code` rows in `plans` — `pro_beta_member`, `pro_beta_contributor` — ranked equal to `pro` so
  `entitlement()`'s existing rank-ladder (`server/lib/plans.js:201-226`) unlocks everything identically to Pro. Each
  gets its own `plan_prices` row (₹299 / ₹199, `annual`) and its own dedicated Razorpay Plan id. The Contributor's
  "locked forever, even as Pro's catalog price rises" behavior is simply Razorpay auto-renewing against that
  fixed-price Plan — no MyNotes code decides the renewal price.
- `beta_offers(install_id, plan_code, expires_at, redeemed_subscription_id NULL)` — one row created the moment a
  person's own Beta ends (tier decided by Phase 2), `expires_at = beta_ended_at + 365 days`. **The window is
  purchase-only, never subscription-length**: buying on day 1 or day 300 both grant one full year from the actual
  purchase date, because a subscription's term always starts at signup regardless of when that happens — nothing
  extra needed to make this true.
- `server/api/create-order.js` gets one new step: before resolving the standard `'pro'` price, check for an
  unexpired, unredeemed `beta_offers` row for this install and use that `plan_code` instead. Checkout,
  verify-payment and the webhook are all unchanged downstream.
- Pro-page UI: a dynamic offer banner (struck-through standard price, the locked price, "for 1 year" or "for life"
  copy) with a countdown — reusing the existing `liveCountdown` component already used on the renewal-reminder card.
  No auto-charge, no auto-conversion, ever: purely an optional purchase surfaced on the existing Pro comparison
  screen.

## Files (once built)

| File | Phase | Job |
|---|---|---|
| `server/schema/007_beta.sql` | 1 | `beta_cohort`, `beta_requests`, `beta_feedback`, `installs.beta_terminated_reason` |
| `server/api/beta/request.js`, `server/api/beta/feedback.js` | 1 | The two user-facing endpoints |
| `server/api/admin/beta.js` | 1, 2 | Approve/reject/terminate, list requests/feedback, rate answers, recalculate rankings |
| `server/api/cron-beta-check.js` + `server/vercel.json` entry | 1 | The daily missed-window sweep |
| `server/lib/validate.js` | 1 | `PLANS` gains `'beta'` |
| `app.js` (`isPaidPlan`/new `isBetaPlan`, Menu, icon swap points) | 1 | Plan gate, Menu row, badge |
| `health.js` (`isPaidPlan` duplicate) | 1 | Same gate, kept in sync |
| `icons/icon-beta.png` | 1 | The supplied artwork |
| `server/public/admin.html` | 1, 2 | New "Beta" section |
| `beta_feedback_answers` table + leaderboard read path | 2 | Per-answer scoring, ranking |
| `server/schema` new `plans`/`plan_prices` rows, `beta_offers` table | 3 | Conversion pricing |
| `server/api/create-order.js` | 3 | One new price-resolution step |
| `plan-compare.js` / the Pro page | 3 | Offer banner + countdown |

## Not done yet

- The exact MCQ question wording.
- The exact per-answer scoring dimensions and roll-up formula (owner will finalize).
- The exact visual design of the Home reminder banner and the Beta detail page.
- Whether a second cohort can run later, and whether that's a rolling window or another fixed 6-week block — out of
  scope for this doc; note it here so it isn't forgotten.
