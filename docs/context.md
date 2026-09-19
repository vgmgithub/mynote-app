# Context & Objective

## The user

- India-based retail investor.
- Manages 3 portfolios:
  - **Me · India** — Zerodha/Kite broker.
  - **Wife · India** — Groww broker.
  - **Me · US** — INDmoney for US stocks.
- Source of truth before this app: a Google Sheet called **X-MyNotes**, specifically the **"Stock" tab** (gid `1300160237`). This sheet is a monthly portfolio performance tracker — the app was built to replace/complement that workflow on mobile.
- Tech literate but **not a frontend specialist**. Comfortable with PHP/MySQL/Mongo/Node/Python on Windows. No native mobile build tools installed — that's why we went PWA.

## Hard constraints (do not violate)

| Constraint | Why it matters |
|---|---|
| **Offline-first** | Phone has spotty connectivity; app must work without internet. |
| **No paid APIs** | User has stated this multiple times. No Alpha Vantage, no Yahoo Finance Pro, no live price feeds. |
| **No live prices** | Confirmed by user: "let it be offline". All prices are manually entered or OCR-ed. |
| **Phone storage only** | **Financial data** never leaves the device — **the product's key selling point.** No cloud sync of user records. IndexedDB is the only store for them. A usage-analytics backend (feature choices, plan, app/device basics) is planned and is the one exception. |
| **No native build** | The app must be installable from the browser. No Cordova/Capacitor/React Native. PWA only. |
| **Free** | No subscriptions, no API keys with billing. |
| **Apache-served** | Lives under `C:\Apache24\htdocs\mynote\`, served at `http://localhost/mynote/`. No Node/Vite dev server. |
| **10-year horizon** | Must remain fast and reliable as data accumulates. |

## What success looks like for the user

> "Can it be my best private tracker?" — direct quote.

That means: simple, fast, private, reliable, no surprises. The user treats this as their **primary** portfolio tracker, not a toy. Treat data loss as the worst possible outcome.

## ⭐ Standing rule: never break backup compatibility with the original MyNote app

A **complete backup from the original MyNote app must always import into MyNote-app** and restore all data.

- **Do not change the data schema.** Keep the same IndexedDB stores, keys and record shapes, and the same backup format (`app: 'mynote-stocks'`, `exportAll()` / `importAll()` in `db.js`). Only add, never rename or remove. The DB name (`mynote-app`) and SW cache name are the only intentional differences.
- MyNote-app differs **only in which pages are shown** (the per-user feature choices in `meta.enabledModules`, free plan = any 5). Hidden features **keep their data**; they are only hidden from the UI.
- Feature limits, onboarding and gating must never delete, filter out, or block importing data. Import restores everything, whatever features are chosen.
- After any change touching `db.js`, stores, meta keys or backup code: run an import of a full old-format backup and check every store restores.

## ⭐ Direction change: from personal notebook to a product for everyone (2026-09-18)

The project started purely for the user's personal use. The user now wants to **take it to everyone**, as an **Android app if possible**.

- **Before that:** redesign the app flow so anyone can understand and use it without difficulty. Today it behaves like the user's personal notes — tracking exactly what they need, with knowledge only they have.
- **Main goal now:** a more **interactive, user-friendly UI**, with a clear onboarding and navigation flow for first-time users.
- **Fresh installs must start empty** — no pre-filled personal data (MF, Metals and Bonds auto-seeding already removed).
- **Impact on older constraints:** "PWA only / no native APK", "single-user app" and "sheet-specific" assumptions in these docs are now being **reconsidered**. Until the user decides, keep the offline-first, private, no-paid-API rules. Ask before starting any Android packaging work.
- **⭐ Key selling point: your financial data is stored only on your device, never online.** Market it that way.
  - No accounts, no login, no ad SDKs, no server-side storage of user records.
  - **Planned exception (later stage): a usage-analytics server, two tiers (decided 2026-09-19, v596).** (1) **Anonymous usage counts, ON by default with an off switch** (Menu > Privacy & Terms > "Turn off anonymous usage counts", stored as `meta.usageCountsOff`): features switched on, plan, app version, device/OS, country-level region (time zone + language, never GPS) and a random `installId`. The server must NOT store IP addresses and must only aggregate. Disclosed on the welcome screen, in the Privacy Policy and in the Terms; the text says it is not active until the service launches. (2) **Age group and gender, opt-in only**: asked on a separate skippable page after choosing features, or Menu > Help improve MyNotes; stored in `meta.usageProfile` only if the user picked something; removable via "Remove my age group and gender" in the Privacy sheet. Never sent, ever: amounts, holdings, categories, notes, vault data, name, contact details. The sender must honour both switches. Needs lawyer confirmation before launch, especially for EU users (device-ID analytics normally needs consent there).
  - Paid tier: everyday use stays offline, but **some advanced Pro features may run online as well as offline** (they must say so). **No cloud-sync subscription** of user records.
  - Any paid tier must work offline. Pro features stay local (advanced analytics, OCR, tax reports, goals, PDF export, extra profiles), sold as a one-time purchase or an offline-checked licence key.
  - Backup goes to storage the user picks, never to our servers.
  - Play Store "Data safety": declare the usage analytics (app info & performance, device id) as collected-not-shared; financial data is not collected. Ship a plain-language privacy policy.
- **⭐ Objective: reach as many people as possible; money is secondary.** Give almost every feature away free, with one catch: any 5 of the features. People pay only if they want something more (extra features, restoring on another device, advanced online features). Never gate basics, never hold data hostage, never make a free user's own data unreachable.
  - **Backup and restore (decided 2026-09-19):** backups are free and unlimited. Free plan = restore on the same device the backup was made on (must still work after reinstalling on that device). Restoring on a different device is a paid feature. Terms say so in the future tense ("planned to become a paid feature", "we will tell you in the app before this changes") because it is not built: today restore works on any device. Keep the Terms wording in step with reality when this is built. Enforcement must be device-level, not per-install id, or a reinstall would strand a free user. Old MyNote backups (no stamp) must always import.
- **⭐ Server phase objectives (stated 2026-09-19):** (1) free of cost at the initial stage; (2) MySQL-compatible open-source database, reachable from Vercel; (3) a written capacity calibration (how many users it can handle); (4) it must be possible to migrate to a bigger database later with no data loss. Rules that follow: plain standard MySQL schema (no vendor-only features), schema kept as versioned SQL files in the repo, the connection string only in environment variables, scheduled dumps to our own storage, and the app's sender must silently ignore server failures (the app never depends on the server).
- **⭐ Objective: a digital Kakeibo - conscious spending and privacy (stated 2026-09-19).** Manual transaction entry is a deliberate product choice, never a weakness. The app does not read or scan SMS, email, bank messages or any private communication. Recording each spend is what builds awareness and a money habit, and the effort is rewarded with insight (patterns, comparisons, "Where you could keep money", "Worth a look", limits, reviews, trends). Keep entry to a few seconds. Do not add automatic SMS/email scanning to match competitors unless explicitly requested. Approved lines: "Track consciously. Spend intentionally." / "Your money stays private. You record what you spend." / "A digital Kakeibo for your everyday money." This shapes onboarding, copy, feature design and roadmap decisions.
- **Guides all design work:** design for a stranger opening the app for the first time — plain labels, guided empty states, no hidden personal conventions.

## Workflow that drives the app

1. User opens broker app → takes screenshot of holdings (sometimes 4–5 screenshots if list is long).
2. Opens MyNotes → taps 📷 → uploads screenshot(s).
3. OCR reads prices/units, fuzzy-matches to existing holdings, user reviews/corrects in modal, Apply.
4. App auto-captures the month's portfolio totals (invested/value/profit-loss + Nifty/Nasdaq benchmark).
5. Over months, the Trend + Heatmap + Overview tabs build up a real history.

Anything that breaks this loop loses the user's trust quickly. Test the OCR flow end-to-end when changing OCR code.

## Communication style with the user

- They prefer **terse, action-oriented** responses. Long preambles annoy them.
- They DO want **clear explanations of root causes** when something goes wrong. Don't just patch — explain *why*.
- They iterate fast. Be ready to revert an approach if they say so ("revert to previous version").
- They sometimes type fragmented phrases like "still its there" or "nothing changed..done hard refresh" — treat these as signals, not finished sentences. Read the screenshot if attached.

## Git workflow

Whenever a change is made (code, docs, anything committable): `git add`, commit with a clear message describing the change, then `git push` — every time, without waiting to be asked. This is a private single-user repo (`vgmgithub/mynote`), so there's no review gate holding work back from `origin/main`.

## Memory persistence

The user has a persistent memory file at `C:\Users\016142\.claude\projects\C--Apache24-htdocs-mynote\memory\MEMORY.md`. Read it via system context at session start. Today's date is auto-injected. Other facts there:
- User profile (India-based retail investor)
- X-MyNotes sheet reference
- Stock app project status
