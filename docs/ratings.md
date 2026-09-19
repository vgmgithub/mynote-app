# Ratings history

One row per rating so releases can be compared. Scores are /10. Same scales every time: **Personal** = as the owner's own finance app, **Public** = as a product for everyone (Android/Play), **Objective** = the project objective in `context.md`.
Add a new column for every rating; never overwrite an old one. Versions are the `APP_VERSION` at the time (v575 is approximate, it predates this file).

## Summary

| | R1 · ~v575 · 2026-09-19 | R2 · v577 · 2026-09-19 | R3 · v578 · 2026-09-19 | R4 · v587 · 2026-09-19 |
|---|---|---|---|---|
| **Personal** | 8.0 | 8.5 | 8.5 | 8.5 |
| **Public** | 6.8 | 7.5 | 8.0 | 8.0 |
| **Objective** | - | - | - | 7.5 |

Note: an interim "7.5 overall" was given between R1 and R2 on a blended scale. It is not comparable and is left out.

## By category

| Category | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| Privacy and offline | 9 | 9 | 9 | 8.5 |
| Feature depth | 9 | 9 | 9 | 9 |
| Ease for a newcomer | 7 | 7 | 7 | 7.5 |
| Data safety | 8 | 8 | 8 | 8.5 |
| Onboarding and website | 8 | 8 | 8.5 | 8.5 |
| Code structure | 5.5 | 8 | 8 | 8 |
| Update reliability | 5.5 | 7.5 | 7.5 | 7.5 |
| Automated testing | 4 | 8 | 8 | 8 |
| Store readiness | 3 | 4.5 | 5 | 5.5 |
| Legal and privacy | - | - | - | 7 |
| Business model | - | - | - | 6 |

Blank (`-`) = not rated yet in that round.

## Reasons

**R1 · ~v575 (Personal 8.0, Public 6.8).** Strong privacy and feature depth. Weak spots: `app.js` was 17k lines, update flow had just been fixed (three causes found), no automated tests, and no path to Android or a listing.

**R2 · v577 (Personal 8.5, Public 7.5).** Automated tests built (19 unit + 21 in-browser), `app.js` split from 18.5k to 4.4k lines across per-screen files, update card confirmed working on the phone. Privacy Policy and Terms added, lifting store readiness a little. Still no Android package.

**R3 · v578 (Personal 8.5, Public 8.0).** Free/paid network plan agreed (news and live metal rates paid, fund NAV free, OCR gated later), and the privacy text corrected to match real behaviour, which closed the "nothing goes online" gap on paper.

**R4 · v587 (Personal 8.5, Public 8.0, Objective 7.5).** Added: name greeting (local only), optional age band and gender, per-install random id kept out of backups, 18+ rule, region from time zone (no GPS), same-device restore rule in the Terms, reach-over-revenue objective, 22 in-browser tests. Privacy dropped slightly (mandatory usage collection). Legal and Business model rated for the first time.
- Objective 7.5: clear and distinctive, but no measurable target, mandatory analytics sits awkwardly beside the privacy pitch, same-device restore works against "reach", and there is no plan for running costs.

## What would lift the next score

- Store readiness (5.5): Android package, then Play listing and Data safety form.
- Business model (6): decide and price the paid features; cover server and store costs.
- Legal and privacy (7): lawyer review; build the analytics consent flow; decide on an opt-out.
- Objective (7.5 to 9): add one measurable goal, settle the analytics opt-out, decide what pays the running costs.
