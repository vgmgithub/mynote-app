# Working rules (keep replies and analysis cheap)

- Final reply: what changed, commit hash, revert hint. Max ~6 lines. No recaps.
- `app.js` is ~19k lines: grep with `-n`, read only the line range needed. Never read it whole.
- Verify once, in one call, printing only pass/fail values. No screenshots unless the visual is the point.
- After every change: bump `CACHE` in `service-worker.js`, commit, push to origin main.
- Never change the data schema or backup format (`app: 'mynote-stocks'`); old backups must still import.
- Docs in `docs/` are partly stale (e.g. backup gap, seed data, install flow). Trust the code.
