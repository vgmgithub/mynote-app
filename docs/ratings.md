# Ratings history

One row per rating so releases can be compared. Scores are /10. Same scales every time: **Personal** = as the owner's own finance app, **Public** = as a product for everyone (Android/Play), **Objective** = the project objective in `context.md`.
Add a new column for every rating; never overwrite an old one. Versions are the `APP_VERSION` at the time (v575 is approximate, it predates this file).

## Summary

| | R1 · ~v575 · 2026-09-19 | R2 · v577 · 2026-09-19 | R3 · v578 · 2026-09-19 | R4 · v587 · 2026-09-19 | R5 · v589 · 2026-09-19 | R6 · v604 · 2026-09-19 | R7 · v618 · 2026-09-19 | R8 · v671 · 2026-09-21 | R9 · v721 · 2026-09-21 | R10 · v759 · 2026-09-23 | R11 · v774 · 2026-09-24 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Personal** | 8.0 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 8.7 | 8.9 | 9.0 | 9.0 | 9.1 |
| **Public** | 6.8 | 7.5 | 8.0 | 8.0 | 8.0 | 8.2 | 8.3 | 8.5 | 8.5 | 8.6 | 8.7 |
| **Objective** | - | - | - | 7.5 | 8.0 | 8.2 | 8.4 | 8.6 | 8.6 | 8.6 | 8.8 |

Note: an interim "7.5 overall" was given between R1 and R2 on a blended scale. It is not comparable and is left out.

## By category

| Category | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 · v721 · 2026-09-21 | R10 · v759 · 2026-09-23 | R11 · v774 · 2026-09-24 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Privacy and offline | 9 | 9 | 9 | 8.5 | 9 | 9 | 9 | 8.7 | 8.6 | 8.6 | 8.6 |
| Feature depth | 9 | 9 | 9 | 9 | 9 | 9 | 9.2 | 9.4 | 9.5 | 9.5 | 9.5 |
| Ease for a newcomer | 7 | 7 | 7 | 7.5 | 7.5 | 7.5 | 7.8 | 8.2 | 8.3 | 8.3 | 8.6 |
| Data safety | 8 | 8 | 8 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 |
| Onboarding and website | 8 | 8 | 8.5 | 8.5 | 8.5 | 8.5 | 8.7 | 9.0 | 9.1 | 9.1 | 9.1 |
| Code structure | 5.5 | 8 | 8 | 8 | 8 | 8 | 8 | 8.2 | 8.2 | 8.2 | 8.2 |
| Update reliability | 5.5 | 7.5 | 7.5 | 7.5 | 7.5 | 7 | 6.5 | 8 | 8 | 8 | 8 |
| Automated testing | 4 | 8 | 8 | 8 | 8.5 | 9 | 8.8 | 8.0 | 8.0 | 8.3 | 8.3 |
| Store readiness | 3 | 4.5 | 5 | 5.5 | 5.5 | 6 | 6 | 6.2 | 6.3 | 6.5 | 6.5 |
| Legal and privacy | - | - | - | 7 | 7.5 | 7.5 | 7.5 | 7.2 | 7.2 | 7.2 | 7.2 |
| Business model | - | - | - | 6 | 6 | 6.5 | 6.5 | 7.5 | 7.6 | 8.2 | 8.2 |
| **Legal accuracy (text matches code)** | - | - | - | - | 8.5 | 9.2 | 9.2 | 8.5 | 8.0 | 7.8 | 7.8 |
| Delivery and operations | - | - | - | - | - | 5.5 | 5.5 | 6.5 | 7.0 | 7.6 | 8.3 |

Blank (`-`) = not rated yet in that round.

**Legal accuracy** is scored against a fixed rule: 10 = every statement in the in-app Privacy Policy and Terms is true in the code today, and provable. See the audit below.

## Reasons

**R1 · ~v575 (Personal 8.0, Public 6.8).** Strong privacy and feature depth. Weak spots: `app.js` was 17k lines, update flow had just been fixed (three causes found), no automated tests, and no path to Android or a listing.

**R2 · v577 (Personal 8.5, Public 7.5).** Automated tests built (19 unit + 21 in-browser), `app.js` split from 18.5k to 4.4k lines across per-screen files, update card confirmed working on the phone. Privacy Policy and Terms added, lifting store readiness a little. Still no Android package.

**R3 · v578 (Personal 8.5, Public 8.0).** Free/paid network plan agreed (news and live metal rates paid, fund NAV free, OCR gated later), and the privacy text corrected to match real behaviour, which closed the "nothing goes online" gap on paper.

**R4 · v587 (Personal 8.5, Public 8.0, Objective 7.5).** Added: name greeting (local only), optional age band and gender, per-install random id kept out of backups, 18+ rule, region from time zone (no GPS), same-device restore rule in the Terms, reach-over-revenue objective, 22 in-browser tests. Privacy dropped slightly (mandatory usage collection). Legal and Business model rated for the first time.
- Objective 7.5: clear and distinctive, but no measurable target, mandatory analytics sits awkwardly beside the privacy pitch, same-device restore works against "reach", and there is no plan for running costs.

**R5 · v589 (Personal 8.5, Public 8.0, Objective 8.0).** Usage sharing became opt-in on its own page after choosing features (skip = nothing sent), which lifts Privacy back to 9, Objective to 8.0 (the mandatory-analytics tension is gone) and Legal and privacy to 7.5. 23 in-browser tests (Testing 8.5). New category Legal accuracy first scored: 8.5, from the audit below.

**R6 · v604 (Personal 8.5, Public 8.2, Objective 8.2).** Built since R5: name greeting and centred headers with a star Pro badge and per-feature "what Pro adds" popups (marked planned); the analytics server, deployed and verified from the real app origin with a strict allow-list; the app-side sender, **off for everyone**, with a "Show what MyNotes would send" screen, turn-off and clear-all deleting server rows, and a test-only link switch; the public `/admin` dashboard (counts only); 39 unit and 28 in-browser tests plus contract tests that tie the app, the server and the legal text together.
- **Up:** Testing 8.5 to 9 (tests now catch cross-file drift, and one exists because a bad edit deleted the Terms), Store readiness 5.5 to 6 (public policy URL, domain chosen, server live, Play billing rules understood; still no Android package), Business model 6 to 6.5 (planned-Pro popups and a free-plan-pressure measure to price from), Objective 8.0 to 8.2 (server-phase objectives written down and met: free, MySQL-compatible, Vercel, capacity, no-loss migration).
- **Down:** Update reliability 7.5 to 7 because nothing since v600 has reached the phone. Vercel's Hobby plan refused every build after about 100 deployments in a day, caused by 112 commits and pushes since 18 Sep 20:00. The update mechanism itself is correct (the phone truthfully reports "latest version v600").
- **New category, Delivery and operations (5.5):** the server works and is verified end to end, but shipping is fragile: the deployment cap, no uptime monitor, no scheduled data export, no alerting, and an environment variable that held the wrong address and went unnoticed until a live test.
- **Defects found and fixed in this stretch, all my own:** the v596 legal-text edit deleted the whole Terms (live briefly), fixed with a structure test in v599; `ALLOWED_ORIGINS` held the server's own address, fixed by cleaning entries and a built-in app origin; build-cap exhaustion, mitigated by an `ignoreCommand` and fewer pushes.

**R7 · v618 (Personal 8.7, Public 8.3, Objective 8.4).** Built since R6: Credit Cards became its own feature and screen (Credit Card, Heatmap, Category Spend, Card Check; the last two locked unless Expenses and Personal Finance are both chosen; no data or schema change; one-time migration for existing Expenses users); Get started as sliding step cards; three-dot menu only on Home with a pulsing Pro star elsewhere; My Passwords fully free; Health Check renamed with a free-plan note; shared house expenses on the Yearly plan feeding the Tracker's Household budget; per-screen tier notes in `docs/tiers.md`; the Kakeibo message on the welcome and Privacy screens.
- **Up:** Feature depth 9 to 9.2 (category-by-card spend view and shared budgets), Ease 7.5 to 7.8 (one card at a time on Home, clearer navigation and a single Pro slot), Onboarding 8.5 to 8.7 (plain welcome cards, grouped picker), Testing 8.5 to 8.8 (new tests for the lock states and cards; a stale-cache failure in the browser suite was diagnosed and the flow verified by hand).
- **Down:** Update reliability 7 to 6.5. The live app was still on v612 when checked; v613 to v618 are pushed but not yet deployed, because of the same Vercel deployment cap (98 commits in 24 hours).
- **Not moved:** Delivery and operations stays 5.5 (no uptime monitor or scheduled export yet); Store readiness 6 (still no Android package); Legal accuracy stays 9.2: re-audited, no new false claim (Credit Cards stores a card name, bank and limit, never card numbers, matching the Privacy line), and the Health Check "2 family members" note is marked planned, not enforced. The full browser suite was last run at v613 (33 of 34 passed); later changes were checked by unit tests and by hand.
- **Open risk:** free-tier limits (Health Check 2 members) are described but not enforced in code.

**R8 · v671 (Personal 8.9, Public 8.5, Objective 8.6).** Built since R7: the Free Plan / Pro Plan split made real in code (live metal rates, one-tap MF NAV and stock screenshot OCR are Pro-only with greyed buttons and a reason; the Free Plan types its own rates; Health Check is capped at 2 family members); an interactive Free vs Pro comparison shared by the website and the in-app sheet; the Pro-only guided yearly plan setup (7 steps, live balance, comparison before overwriting an imported plan); Home "Get started" rebuilt as an ordered money flow (yearly plan, emergency fund, loans, fixed bills, invest, health, cards, daily, personal, savings, passwords, backup) with skip on optional steps and a fold-down card for Pro; the Cash flow Loan row became a list of loans with Paid, previous loans struck through with their date, and a new Actual Balance after loans; household budget is now House Exp + others' contribution (the ×2 doubling is gone); Emergency Fund equal-contribution guidance and a 2% lending-rate floor; usage analytics switched ON with a daily check-in, an install_days table and "active today / regular users" tiles.
- **Up:** Feature depth 9.2 to 9.4; Ease 7.8 to 8.2 (the ordered first-run flow and plain sub-points); Onboarding 8.7 to 9.0; Business model 6.5 to 7.5 (the plan split is now enforced in code and explained in one shared table, though there is still no price and no payment path); Update reliability 6.5 to 8 (the live site is v671, current with the repo, after the deployment backlog cleared); Delivery and operations 5.5 to 6.5 (analytics verified end to end in production); Code structure 8 to 8.2 (three new pure-logic modules with unit tests: plan-setup, get-started, plan-compare); Store readiness 6 to 6.2.
- **Down:** Automated testing 8.8 to 8.0. The browser suite has not been run since v613 and its Get started test is known to be stale, so roughly fifty changes rest on unit tests and hand checks. Privacy and offline 9 to 8.7 and Legal and privacy 7.5 to 7.2: anonymous counts now actually leave the device by default, without the lawyer review the go-live checklist asks for, and EU consent is no longer a theoretical gap.
- **Legal accuracy 9.2 to 8.5 — one statement is now misleading.** The welcome screen card reads "Nothing leaves your phone - No account and no cloud", written when nothing was sent. Since v624 the anonymous usage counts are sent by default, which the Privacy Policy discloses correctly. The two disagree, and the welcome card is what a new user reads first. Everything else re-audited true: the Pro-only lines for metal rates, NAV and OCR match the code (the Free Plan makes no request at all), the Health Check limit is enforced, and the comparison table marks planned items as planned. Also open: LEGAL_CONTACT is still the owner's employer email.
- **Fixed in v674 (after this rating was written).** The welcome card now reads "Your money stays on your phone - No account or cloud. Only anonymous usage counts are sent, and you can switch them off." A second, worse error was found and fixed at the same time: the Privacy Policy short version still said "Nothing is counted today", and the Terms still said "Once our analytics service launches" - both now state that counting started on 20 September 2026 and is on unless switched off. The Terms also name the Free Plan limits the code enforces, the landing page discloses the counts in its lead, its privacy point and a new FAQ, and LEGAL_CONTACT is no longer an employer address. Unit tests now fail if any of these drift back. Legal accuracy re-scored **9.3** (was 8.5); the lawyer review is still outstanding.

**R9 · v721 (Personal 9.0, Public 8.5, Objective 8.6).** Built since R8: the Free/Pro split tightened (News Feed and the Home Coming Up strip are Pro Plan only, the Feed also off until switched on); the news key moved to the server with a ten-day archive, provider backoff and per-company follower counts that cannot be traced to a person; a rebuilt admin dashboard (tabs, cards, filters, retention, Free against Pro, a Stocks and News tab); SIP dates and a SIP reminder with a "SIP done" popup that records the purchase from Home; a draggable Coming Up strip; the US Feed auto-sync fixed; the two app icons; the install bar; ADMIN_KEY set and the admin locked.
- **Up:** Feature depth 9.4 to 9.5 (SIP done from Home, the news archive, the admin analytics). Ease 8.2 to 8.3. Onboarding and website 9.0 to 9.1 (icons in the comparison table, the install bar). Business model 7.5 to 7.6 (Pro gates are sharper and the payment route is designed, but nothing can be bought). Delivery and operations 6.5 to 7.0 (admin locked, news health and provider status visible, provider backoff, env vars set). Store readiness 6.2 to 6.3 (icons, the Android migration plan, the domain need identified).
- **Down:** Privacy and offline 8.7 to 8.6. The News Feed is the first feature that sends a company name to our server. It is Pro only, off until switched on and consented, and the counts are built so they cannot be traced to a person, so the fall is small. Legal accuracy 8.5 to 8.0 (audit below). Automated testing stays 8.0.
- **A process failure worth naming.** The SIP popup shipped in v706 could never have saved: it wrote to a store that does not exist and used a helper that was never imported. It was reported as verified "in code" without being run. It was found when the phone showed it broken, and rebuilt and run end to end in v719. No test covers that flow, which is why the score for testing does not rise.
- **Not moved:** Data safety 8.5 (the SIP save reads the fund fresh before adding to it), Code structure 8.2, Update reliability 8, Legal and privacy 7.2 (lawyer review still pending).
- **Public 8.5, held.** The features rose, but two things pull the public score down: nothing can be bought yet, and the name "MyNotes" is generic. It will collide with hundreds of note-taking apps in search and is hard to protect as a trademark. The domain and the icon both carry it, so the cost of changing it rises with every step.

**R10 · v759 (Personal 9.0, Public 8.6, Objective 8.6).** Built since R9: Pro became a subscription (Monthly Rs 49, Annual Rs 399, lifetime priced but not sellable) with Razorpay test-mode checkout, result pages, payment history, refunds that switch Pro off, a renewal card and expiry popup, and the plan end date enforced offline; staging and production separated by address in `config.js` with a test against hardcoded servers; build control for four Vercel projects; an admin Payments and Subscriptions view with a test clock; news kept only when it names the company. 315 unit tests pass.
- **Up:** Business model 7.6 to 8.2 (a working, server-priced, install-bound payment path), Delivery and operations 7.0 to 7.6 (environments, production-data rules, build control), Automated testing 8.0 to 8.3, Store readiness 6.3 to 6.5.
- **Down:** Legal accuracy 8.0 to 7.8: the Terms say "MyNotes cannot take a payment today", which is false on staging (test mode); the Privacy text does not name Razorpay as a payment processor; no refund or cancellation policy page; `docs/tiers.md` still says one-time Rs 399.
- **Held:** Personal (payments add nothing for the owner), Objective (effort went to monetising before a measurable reach goal exists), Code structure (`expense-ui.js` 4.9k and `app.js` 5.2k lines). Risks: the admin API sits at the 12-function Hobby cap, and Hobby is non-commercial, so production needs the paid plan before it takes money.

**R11 · v774 (Personal 9.1, Public 8.7, Objective 8.8).** Built since R10: production released on the same code as staging, its own database migrated to schema 006, and the owner's production-data rule followed on every step (nothing written without a stated plan and a go-ahead); Pro prices now show on production with an honest "coming soon" instead of hiding pricing (Business model, previously blocked on "nothing sellable yet on the live address"); admin dashboard redesign (compact cards, merged subscriptions/payments, People page as icon-led bricks); Get started shows real progress ("N of total completed", a bar, a one-time "You're all set!" card) instead of just vanishing; both spend-entry forms sped up (recent categories, usual-amount chips, Today/Yesterday, remembers last payment method, "Add & next", a live "left after this" line); a real duplicate-reminder bug found and fixed (the renewal card and its toast could both fire from one event). 355 unit tests pass.
- **Up:** Delivery and operations 7.6 to 8.3 (production is live, schema-tracked, and gated by a written rule rather than trust - this cycle proved the rule works end to end, including catching an out-of-band schema edit). Ease for a newcomer 8.3 to 8.6 (the two forms filled most often are now visibly faster to use). Business model 7.6 to 8.2 (a second, real address now shows real prices without being able to take money by mistake). Automated testing held at 8.3: the new form logic has full unit coverage, but neither quick form nor the reminder fix has a browser-suite assertion yet.
- **Down:** nothing regressed.
- **Held:** Legal accuracy 7.8 - not re-audited this cycle; the R10 finding (the Terms say "MyNotes cannot take a payment today", which is false on staging where test-mode checkout works) is still open and should be revisited before the next legal review.
- **Objective 8.6 to 8.8:** production existing, correctly walled off, and now the address that "reach" has to actually grow into. Not yet 9: there is still no measurable adoption target (e.g. "N active installs by date"), and payments - what would fund it - are deliberately still off everywhere real money could move.

## Legal accuracy audit (R9, v721)

Re-audited the Privacy and Terms text and the landing FAQ against the code. Two statements were false and one was misleading, all introduced by the News Feed moving to the server. Fixed in v721.

| Verdict | Claim | Action |
|---|---|---|
| **False** | Privacy: "What we never collect: ... names of funds or stocks" | The News Feed sends a company name to our server, which keeps it. Now states the one exception. |
| **Misleading** | Landing FAQ: "On your device only. No server, no copy anywhere else." | There is a server (usage counts, the membership check, news). Reworded to "your records are never uploaded". |
| **Incomplete** | Landing FAQ: "Only anonymous usage counts" | Omitted the membership check and the Pro online lookups. Rewritten to name them. |
| True | News Feed paragraph (Pro only, off until switched on, name only, ~10 days kept, weekly per-company code) | Matches `feed.js`, `server/api/news.js`, `lib/news.js`. |
| True | Membership check and usage counts, and the switch that does not stop the check | Unchanged since R8. |
| Stale, not user-facing | `docs/feed.md` and `docs/features.md` describe the old direct-to-Marketaux flow | Note added at the top of `docs/feed.md`. |

Also updated `LEGAL_UPDATED` to 21 September 2026, since the text changed. Score 8.0: after the fixes nothing in the text is false, but the audit found three problems in one release cycle, which says the check is not yet automatic. A test that fails when a network call is added without a matching line in the Privacy text would close that.

## Legal accuracy audit (R5, v589)

Rule: 10 = every claim in the app's Privacy/Terms is true in code. Checked each claim against the source.

| Verdict | Count | Claims |
|---|---|---|
| True in code | 24 | Money data stays on device; backups go only where the user saves them; vault is encrypted on-device (PBKDF2 + AES-GCM); NAV sends fund names only; News off until a key is added; no ads/tracking SDKs/third-party cookies; no bank logins; Clear all data wipes every store; export/import backup; free plan = any 5, changeable; Menu > Usage data / Backup / Privacy & Terms exist; opt-in stored only if the user shares; skip stores nothing; name local; install id local and kept out of backups; 18+ band only; restore limit stated as not enforced |
| Was inaccurate, fixed in v589 | 4 | "Settings > Clear all data" (it is in Menu); OCR host (also downloads language data, not just the library); Marketaux key "only on this device" (it is also in backup files); metal rates cadence (about once a day, not every open) |
| Promise ahead of code (disclosed, not built) | 4 | Analytics server does not exist yet, so nothing is sent today; paid tier and paid online features; restore-on-other-device limit; Play Data safety form |
| Stated but not enforced or recorded | 2 | "You must be 18+" is a statement, not a check; acceptance of the Terms is not recorded (no version/date stored) |

Score 8.5: nothing in the text is false or misleading after the v589 fixes, but four claims describe things not built yet, and two rules rest on the user's word alone.

To reach 10: build the server exactly as described (send only when `share` is true), record Terms acceptance (version and date in `meta`), add an 18+ confirmation to the welcome consent, enforce or drop the restore limit, and re-audit on every legal change.

**Audit update, v591 (2026-09-19).** Two of the six gaps closed: (1) the welcome consent line now says "you confirm you are 18 or older and agree to the Terms and Privacy Policy", and (2) Get started records `meta.legalAccepted = { version, adult: true, at }` (version = the legal text's date), covered by a browser test. Legal accuracy re-scored **9.0** (was 8.5). Open: analytics server not built, paid tier not built, restore limit not enforced, and an install set up by restoring a backup skips the welcome screen, so it has no acceptance record unless the backup carried one. Also open: no re-consent when the legal text changes.

**Audit update, v592 (2026-09-19).** The restore-on-another-device limit is now worded as a plan ("planned to become a paid feature", "we will tell you before this changes", "today a backup can be restored on any device") instead of a rule, so the Terms state only what is true today. That removes it from the "promise ahead of code" list. Legal accuracy re-scored **9.2** (was 9.0). Not 9.5 because three things remain: the analytics server is not built (the text describes it conditionally, but nothing yet backs it), a restored install has no acceptance record, and nothing asks for consent again when the text changes. Scoring note: this rise is from the text becoming accurate, not from the feature being built; when the limit is built, the Terms must be updated in the same change.

**Audit update, v596 (2026-09-19).** Usage model changed to two tiers: anonymous feature counts ON by default with an off switch, age group and gender opt-in. Re-audited every new claim against the code: welcome screen discloses the counts (true), Privacy sheet has "Turn off anonymous usage counts" (true, tested) and "Remove my age group and gender" (true), Menu > Help improve MyNotes exists (true), Skip/both-blank stores nothing (true, tested), text states plainly that nothing is sent until the service launches (true today, since no sender exists). Legal accuracy stays **9.2**: no false statement, but the server and its promises (no IP stored, aggregate only) are still unbuilt. Lawyer check needed on default-on counts, especially for EU users.

**Correction, v599 (2026-09-19).** The v596 edit to `legal-text.js` deleted the whole Terms of Use and four Privacy sections (What we do not do, Your control, Age, Changes and contact), and it was live for v596 to v598. The v596 audit above was wrong to say "no false statement": it checked the new claims but not that the file still contained the rest. Restored in v599, with a new unit test (`tests/unit/legal-text.test.js`) that fails if any required section is missing and checks that every menu item or button named in the text exists in `app.js`. Legal accuracy for v596 to v598 should be read as **lower than 9.2** (the Terms were absent); the restored v599 text scores **9.2** again.

**Audit update, v604 (2026-09-19).** Re-audited the legal text against the code before scoring. No statement is false. New claims checked: turning counts off and Clear all data delete the server's rows (implemented in `sender.js`, tested with a stubbed network); "Show what MyNotes would send" exists and shows the exact message (tested); nothing is sent by default (`USAGE_ENABLED = false`, and a unit test fails if the switch and the "Not active yet" wording ever disagree); the server rejects every field off its allow-list and Under 18 (tested live). Legal accuracy stays **9.2**. Still open: the contact address is the owner's employer mailbox and must become a domain address before launch; the hosting-provider-logs sentence is not yet in the Privacy text; a restored install has no acceptance record; nothing re-asks consent when the text changes; and the hidden `?usagetest=1` link lets a person switch sending on for their own device while the text says "Not active yet" (true for everyone else, and it is opt-in by deliberate link).

## What would lift the next score

- Store readiness (6): Android package, then Play listing and Data safety form; buy the domain.
- Business model (6.5): decide and price the paid features; cover server and store costs.
- Legal and privacy (7.5): lawyer review; build the analytics server to match the text.
- Legal accuracy (9.0 at v591): build what the text describes (server, paid tier, restore limit); ask for acceptance on restored installs and when the text changes; re-audit after each legal change.
- Objective (8.2 to 9): add one measurable goal (for example 30-day active installs); decide what pays the running costs.
- Delivery and operations (5.5): deploy the pending v604, dashboard and sender; push in batches; add an uptime monitor on `/api/health`, a scheduled weekly `npm run export`, and a second host or plan upgrade before a launch spike.
- Update reliability (7): the phone should never sit behind for hours; fix delivery first.
