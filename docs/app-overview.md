# MyNotes: newcomer's guide, and the gaps

Written at **v682 (21 Sep 2026)** from the code, not from older docs (several of those are stale, see "Stale docs" at the end).

## 1. What MyNotes is

A **private, offline-first money app** that runs in the phone's browser and installs like an app (a PWA). One app for investments, savings, household and personal spending, credit cards, family health records and passwords.

Three ideas run through everything:

1. **Your records never leave the phone.** Everything is stored on the device (IndexedDB). There is no account and no cloud copy. Backups go to a file or folder the user picks.
2. **Track consciously.** Entry is manual on purpose (a digital *Kakeibo*). The app never reads SMS or email. The pause of writing a spend down is the habit; the app does the maths and the insights.
3. **Reach over revenue.** Almost everything is free. The **Free Plan** gives any 5 of the 14 features; the **Pro Plan** gives all of them plus time-savers (one-tap fetches, screenshot reading, a guided yearly plan).

Only **anonymous usage data** (which features are on, plan, app version, device type, days opened) is sent to our server. It is on by default, can be switched off, and carries no amounts, notes or names.

## 2. The 14 features (what a user can do today)

| Feature | What it does | Free vs Pro |
|---|---|---|
| **Stocks** | 3 portfolios (Me·India, Wife·India, Me·US); Holdings, Heatmap, Trend, Overview, Feed tabs; monthly returns; news feed with the user's own Marketaux key | 📷 screenshot update is **Pro** (Paytm Money and Groww for Indian stocks, INDmoney for US; Groww updates price only; others coming). Free types units, average and current price |
| **Mutual Funds** | Holdings, Overview, Targets, Performance; SIPs, buys/sales, XIRR, benchmark bands | ☁️ one-tap NAV fetch for all funds is **Pro**; Free types each fund's NAV |
| **Fixed Deposits** | FDs, Overview, Ladder; maturity chains and rollover; maturities show on Home "Coming up" | Same on both |
| **Gold & Silver** | Overview, Gold, Silver, SGB; buys, sells, interest | Daily gold, silver and USD rates plus a tunable India % are **Pro**; Free types its own rates in one Home card |
| **Bonds** | Bonds, Overview; coupon schedule, real payouts logged | Same on both |
| **Dividends** | Per stock, year by year; Calendar (needs Stocks) | Same on both |
| **Emergency Fund** | A family lending pot: Funds, Targets (ladder), Loans, Log, Rules. Loans have an interest rulebook (2% minimum, free windows) and can post spends into the household budget. Log recommends equal contributions for couples | Same on both |
| **Bank Savings** | List of accounts with balances typed monthly; **Account type** dropdown | Same on both |
| **Inflation Calculator** | Future amount to today's value | Same on both |
| **Expenses** | **Cash flow** (monthly sheet: In Hand, Virtual Balance, red rows, Loan list, Other Expense; Available and Actual Balance), **Tracker** (daily household spends against the household budget), **Review** (forecast, creeping categories), **Yearly plan** (salary and allocations) | Pro adds a mandatory **guided yearly plan setup** |
| **Credit Cards** | Own screen, 4 tabs: Credit Card (cards, billing cycles, bills), Heatmap (month by month), Category Spend, Card Check (billed vs logged). The last two unlock only when Expenses and Personal Spending are both on | Same on both |
| **Personal Spending** | Spends, Limits (card and UPI), Review, Tags; a **Per day left** box | Same on both |
| **Health Check** | Family records, parameters, BMI, out-of-range filter, family comparison table, share as image | Free: **2 family members**. Pro: no limit |
| **Password Vault** (My Passwords) | Encrypted vault behind a master password that cannot be recovered; auto-lock, history, CSV import and export | Free for everyone, no Pro tier |

### Around the features
- **Home:** greeting, **Get started** card, totals, "Coming up" strip, rates card (Metals), then cards in the order Investment, Expense, Personal Finance, Credit Cards, Savings, Health Check, My Passwords. Pro folds Get started to one row.
- **Get started (ordered money flow):** Yearly plan (Free only), Emergency fund, Existing loans, Fixed house bills, Investments, Health, Cards, Daily house spends, Personal spending, Savings, My Passwords (optional), Backup (always last). Optional steps have Skip.
- **Onboarding:** welcome and Terms, then choose up to 5 features (Free), then optional name/age/gender. Pro skips the picker and gets the yearly plan setup.
- **Backup and restore:** one JSON file (all 22 stores, including the encrypted vault). Chrome and Edge keep the newest 2 in a chosen folder; other browsers download. Empty backups and shrinking a fuller backup are refused; a safety snapshot is written before each restore.
- **App lock:** 4-digit PIN plus optional biometric. **Menu:** install, updates, backup, choose features (Free), clear data, lock, name, help improve, privacy and terms, feed settings.
- **Website:** a landing page with install guides, sample screens, the Free vs Pro comparison and an FAQ.

## 3. Free Plan vs Pro Plan (what is enforced today)

Enforced in code: any-5-features (picker), Health 2 members, no rate fetch, no NAV fetch, no screenshot OCR on Free; the Pro guided setup. Plan status comes from the server and is remembered on the device; it survives Clear all data (paid installs only).
Not yet enforced: restoring a backup on another device (stated as planned only), advanced reports, receipt scan and exports (marked Planned).
**Pro cannot be bought yet**: the admin sets the plan by hand.

## 4. How it is built (for developers)

- **No build step.** Vanilla ES modules, IndexedDB (`mynote-app`, version 19, 22 stores), a service worker (stale-while-revalidate). After every change bump `CACHE` in `service-worker.js` and `APP_VERSION` in `app.js` to the same number.
- **Files:** `app.js` core (Home hub, picker, onboarding, menu, backup UI, init); screens in `*-ui.js` (`expense-ui` 4.8k lines, `personal-ui` 2.9k, `health`, `ef`, `vault-ui`, `mf-ui`, `cc-ui`, `cards-ui` and more); pure logic with no DOM in `core mf fd bonds metal dividend emergency credit plan-setup get-started plan-compare usage-core`; shared screen state in `state.js`.
- **Never change** the data schema or the backup format (`app: 'mynote-stocks'`). Additive optional fields only, so old backups import.
- **Server** (`server/`, separate Vercel project, TiDB Cloud): `collect`, `forget`, `plan`, `stats`, `health`, admin `installs` and `plan`. Stores install id, features, plan, version, device, `install_days` (one row per day opened). Never IPs or amounts. `/admin` is the dashboard.
- **Deploy:** two Vercel projects from one repo (`/` app, `/server` backend); Hobby plan, so batch pushes.
- **Tests:** `npm test` runs 12 unit and server test files (all pass). The in-browser suite (`tests/`, about 30 tests) runs only on request.

## 5. Gaps

### A. Fix soon (small, real)
1. **Admin page is open.** No `ADMIN_KEY` is set, so anyone with the address can read every install and change any plan. Set it in Vercel.
2. **Backup reminder ignores health.** `dataCount()` (`app.js:3438`) leaves out `healthPeople` and `healthChecks`, so editing only health data never triggers "changes since last backup".
3. **The 5-feature limit is only checked in the picker.** A restored backup with more than 5 features is not capped, so a Free user can exceed it that way.
4. **Browser suite not run since v613.** Two tests are known stale (Get started labels; the old welcome card text) and there is no coverage for recent work: plan setup, the plan comparison sheet, the loans list, Pro gating of NAV/OCR/rates, the Health 2-member limit, the Get started flow.
5. **Test rows in the live database.** 16 fake `windows` v607 installs from earlier testing, if not already deleted.
6. **No "undo restore".** A pre-restore snapshot is written (`readPreRestoreSnapshot`) but no screen reaches it.
7. **Feed empty state.** With no Marketaux key the Feed tab has no explanation.

### B. Product and business
8. **No way to buy Pro.** No price, payment path or licence; a plan is tied to the install id, so a new phone starts Free until the admin marks it.
9. **Restore on another device** is described as a future Pro feature but is not built or enforced.
10. **Analytics side effect:** Pro installs report all 14 features, which skews "which features people choose". Consider sending the chosen list, not the effective one.
11. **Open decisions:** does the Vault count toward the 5 free slots; should Home's per-day figure stay free (currently free).
12. **No monthly prompts.** The monthly routine (Emergency Fund log, card bills, loans, bank balances) has no reminder or "this month" checklist after the first pass.
13. **Personal-only users lost Card Check** (moved to Credit Cards by design, but worth a note in release messaging).

### C. Store and legal
14. **No Android package** (TWA), Play listing or Data Safety form; no domain bought.
15. **Legal:** lawyer review outstanding; EU consent for analytics that is on by default; the contact address is a personal Gmail.
16. **Vault master password is unrecoverable** by design; make sure the first-run wording keeps saying so.

### D. Operations
17. No uptime monitor on `/api/health`, no scheduled weekly `npm run export`, no alerts; TiDB Starter and Vercel Hobby limits are the launch-spike risk.
18. The `install_days` table is created on first use; run migration `002` so a fresh database matches the repo.

### E. Code quality
19. **Big files:** `app.js` and `expense-ui.js` are each about 4.8k lines; split further as features grow.
20. **Dead code:** `openMfValueSheet` (a full bulk-NAV sheet nothing opens), `saveSnapshot`, `clearSavedFolder`, `cleanNum`, `buildSeedFund`, `generateSipSchedule`, `parsePaytmTransactions`, `ocrImage`, plus unused constants (`SEED_*`, `OCR_SUPPORTED`, `PRO_COMMON`, and others). Delete or use them.
21. **Duplicate helper:** `isPaidPlan` is defined in `app.js` and again in `health.js`.
22. **Inconsistent names:** Expense / Expenses / Household Expenses; Personal Spending / Personal Finance; Metals / Gold & Silver; Password Vault / My Passwords; MF / Mutual Funds. Pick one each.

### F. Accessibility
23. Pinch-zoom is blocked (`user-scalable=no`). `field()` labels are not tied to inputs. About ten icon-only × buttons lack `aria-label`. Tabs have no `role=tab`, sheets no `role=dialog`, and toasts have no `aria-live`.

### G. Stale docs (trust the code)
`health-check.md` and `README.md` still describe a health backup gap (fixed). `tiers.md` says nothing is enforced. `expense.md` lists five tabs and Credit Card inside Expense (now four tabs and its own screen). `features.md` puts Dividends under Investment (it is under Savings) and does not know the Get started card, the plan comparison, the yearly plan setup or the loans list. `architecture.md` and `README.md` describe Apache on localhost; live is Vercel.

## 6. Suggested order
1. Set `ADMIN_KEY`; delete the fake rows; run migration `002`.
2. Fix the health backup reminder and cap restored features at 5 on the Free Plan.
3. Run the browser suite, fix the two stale tests, add tests for the new Pro gating.
4. Refresh the stale docs and unify the names.
5. Decide pricing and a payment path; then the Android package and Play listing.
6. Accessibility basics, then the monthly checklist.
