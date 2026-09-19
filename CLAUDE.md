# Working rules (keep replies and analysis cheap)

- Final reply: what changed, commit hash, revert hint. Max ~6 lines. No recaps.
- `app.js` is ~4.4k lines: grep with `-n`, read only the line range needed. Never read it whole.
- Verify once, in one call, printing only pass/fail values. No screenshots unless the visual is the point.
- After every change: bump `CACHE` in `service-worker.js` AND `APP_VERSION` in `app.js` (same number), commit, push to origin main.
- Never change the data schema or backup format (`app: 'mynote-stocks'`); old backups must still import.
- Docs in `docs/` are partly stale (e.g. backup gap, seed data, install flow). Trust the code.

# File map (read the small file, not app.js)
- `app.js` core: DOM helpers, dialogs, Home, feature picker/onboarding, stocks, backup UI, init/update. Other screens live in `*-ui.js` (`banksav ef bonds-ui divs-ui metals-ui cards-ui mf-ui vault-ui feed-ui personal-ui expense-ui`); shared screen state in `state.js` (`ui`). They import helpers from `./app.js`; app.js re-exports what moved out.
- `ef.js` Emergency Fund screens (logic in `emergency.js`) · `banksav.js` Bank Savings · `health.js` Health · `vault.js` vault crypto
- `landing.js` website landing page · `db.js` IndexedDB (name `mynote-app`) · `backup.js` folder backups · `lock.js` app lock
- Pure logic (no DOM): `core.js` `mf.js` `fd.js` `bonds.js` `metal.js` `dividend.js` `emergency.js` `credit.js`
- Split more with the AST tool: `node <scratchpad>/tools/extract.js <startLine> <endLine> <new.js> [--apply]` (dry-run first; add the new file to `service-worker.js` ASSETS)

# Tests (run before every commit that touches logic or app.js)
- Unit (pure logic + syntax of every module): `npm test` (Node 20, no dependencies)
- Integration (real app in a frame, isolated DB `mynote-app-test`): open `/tests/` in the browser pane, wait for "All N tests passed" (`window.__results`). Never touches real data.
- After splitting or refactoring app.js, both must pass.
