# Legal accuracy audit

Checks every statement in the in-app Privacy Policy and Terms (`legal-text.js`, shared with the landing page and
`privacy.html`) against what the code does. Scale: 10 = every statement is true in the code today and can be shown.
One section per audit; never overwrite an old one. Earlier audits (R5, R9) are in `ratings.md`.

## Audit · v873 · 6 October 2026 (text dated 6 October 2026)

**Score: 9.0 → 9.4.** Four statements no longer matched the code; all four are corrected in v873. Nothing found
claims less protection than the app gives, and nothing found was a false promise about money or payments.

### Corrected in v873

| Verdict before | What the text said | What the code does | Now says |
|---|---|---|---|
| **Incomplete** | Backups: files you save, never sent to us. Nothing about what identity they hold. | Since v854 a backup carries an `identity` row (install id + anonymous name), `db.js` `exportAll`; the plan stays out (`DEVICE_ONLY_META`). | A backup carries the random install identifier and anonymous name, never the plan or membership. |
| **Incomplete** | Nothing about restoring a backup from another install. | `chooseIdentity` (`identity.js`) takes the backup's identity; `forgetAbandoned` (`sender.js`) asks the server to delete the old install. | Restoring another install's backup takes its identity and asks the server to delete the previous one. |
| **Inaccurate** | Website visits: "only the day and the two numbers are stored"; the browser remembers "the date of its last counted visit". | `site_visits` holds visitors, views, new, week and month counts (`server/lib/visits.js`); the browser keeps day, week, month and a seen marker (`landing.js` `countVisit`). | Lists the counts stored and the day / week / month markers. |
| **False** | "Menu > Clear all data erases everything on this device." | `wipeAllData` (`lock.js`) keeps the install id, anonymous name and a Pro / Beta plan; `clearAllDataFlow` also calls the server forget. | Erases every record, setting and vault item and asks the server to delete; keeps only the identifier, name and a Pro / Beta membership. Removing the app or clearing site data erases those too. |

### Checked and true

| Statement | Evidence |
|---|---|
| Financial records never leave the device | No module posts records; `sender.js` payload is built by `buildPayload` (features, plan, version, device, region, days). Contract tests: `tests/unit/usage.test.js`. |
| Membership status is device-only and never in a backup | `plan` is in `DEVICE_ONLY_META` (`db.js`). |
| Usage counts are on unless turned off; turning off deletes server rows | `USAGE_ENABLED = true`; the turn-off calls `requestForget`. |
| No IP stored with the counts | `server/api/collect.js` reads only Origin and Content-Length; no IP column in any schema. |
| Website visits: no id, no cookie, skipped on Do Not Track / GPC | `landing.js` `countVisit` sends only `{first, fresh, week, month}`, `credentials: 'omit'`; DNT / GPC return early. Test: `server/test/visits.test.js`. |
| Metal rates, NAV and OCR are Pro-only and send no personal data | Free Plan makes no request (feature gates); NAV sends the fund name only. |
| News Feed sends only a company name, off until switched on | `feed-ui.js` / `server/api/news.js`; weekly per-company hash for follower counts. |
| Beta feedback is the one place typed text is stored, only if joined | `server/lib/beta.js`; nothing is sent without a request. |
| Anonymous name chosen at random, never from typed text, and stable | `identity.js`, `aliasLocked`; the server keeps it unique. |
| "The Pro Plan is not on sale yet and MyNotes cannot take a payment today" | Production shows the "Pro is coming soon" popup (v849); live keys are not set. Staging takes only Razorpay test payments. |
| Prices: ₹49 / ₹399; Beta ₹199 / ₹299 | `plan_prices` rows, `plan-compare.js`. |
| Free Plan limits (Health Check 2 people, typed rates, per-fund NAV, typed holdings) | Enforced in the feature gates. |
| 18+ confirmation and the acceptance note stay on the device | `legalAccepted` meta row (`app.js`). |
| A new version appears with a new date | `LEGAL_UPDATED` is shown on the screen and stamped into `legalAccepted`. |

### Still open (why not 10)

- **No re-acceptance.** A changed text shows a new date but nobody is asked to accept it again, and a restored
  install has no acceptance record of its own.
- **No lawyer review** of either document (tracked under "Legal and privacy", 7.0).
- **Contact** is a Gmail address; a domain address is planned.
- **Admin deletion** (v860) is not described. It is an operator action that removes server rows only, so it narrows
  what is held rather than widening it; worth one line if a "how we delete data" section is added.
