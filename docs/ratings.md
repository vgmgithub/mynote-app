# Ratings history

One row per rating so releases can be compared. Scores are /10. Same scales every time: **Personal** = as the owner's own finance app, **Public** = as a product for everyone (Android/Play), **Objective** = the project objective in `context.md`.
Add a new column for every rating; never overwrite an old one. Versions are the `APP_VERSION` at the time (v575 is approximate, it predates this file).

## Summary

| | R1 · ~v575 · 2026-09-19 | R2 · v577 · 2026-09-19 | R3 · v578 · 2026-09-19 | R4 · v587 · 2026-09-19 | R5 · v589 · 2026-09-19 | R6 · v604 · 2026-09-19 |
|---|---|---|---|---|---|---|
| **Personal** | 8.0 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 |
| **Public** | 6.8 | 7.5 | 8.0 | 8.0 | 8.0 | 8.2 |
| **Objective** | - | - | - | 7.5 | 8.0 | 8.2 |

Note: an interim "7.5 overall" was given between R1 and R2 on a blended scale. It is not comparable and is left out.

## By category

| Category | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| Privacy and offline | 9 | 9 | 9 | 8.5 | 9 | 9 |
| Feature depth | 9 | 9 | 9 | 9 | 9 | 9 |
| Ease for a newcomer | 7 | 7 | 7 | 7.5 | 7.5 | 7.5 |
| Data safety | 8 | 8 | 8 | 8.5 | 8.5 | 8.5 |
| Onboarding and website | 8 | 8 | 8.5 | 8.5 | 8.5 | 8.5 |
| Code structure | 5.5 | 8 | 8 | 8 | 8 | 8 |
| Update reliability | 5.5 | 7.5 | 7.5 | 7.5 | 7.5 | 7 |
| Automated testing | 4 | 8 | 8 | 8 | 8.5 | 9 |
| Store readiness | 3 | 4.5 | 5 | 5.5 | 5.5 | 6 |
| Legal and privacy | - | - | - | 7 | 7.5 | 7.5 |
| Business model | - | - | - | 6 | 6 | 6.5 |
| **Legal accuracy (text matches code)** | - | - | - | - | 8.5 | 9.2 |
| Delivery and operations | - | - | - | - | - | 5.5 |

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
