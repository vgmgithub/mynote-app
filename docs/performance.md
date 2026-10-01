# Performance results

One section per measurement so releases can be compared. Add a new section; never overwrite an old one.

## v861 · 2026-10-01 (local Apache, Browser pane, cold start, test DB)

| Measure | Result |
|---|---|
| First contentful paint | 132 ms |
| DOMContentLoaded / load | 137 ms |
| Server response (TTFB) | 17 ms |
| JavaScript at start | 44 files, about 985 KB |
| JS heap | 13 MB |
| DOM elements on the first screen | 413 |

Tests at the same time: unit and server 480/480; in-browser suite 33/34 (the one failure was a stale expected backup version, 20 instead of 21, fixed in `tests/browser.js`).

Notes
- Local Apache sends no compression, so the 985 KB is uncompressed. Vercel compresses on the live site; that is not measured here.
- This is a fast desktop browser. No phone measurement exists yet. Nothing earlier (v802 or before) was measured, so there is no performance comparison, only the rating comparison in `ratings.md`.
- Largest files: `expense-ui.js` about 278 KB, `app.js`, `personal-ui.js`.

## Improvement options (no feature or data change)

1. **Measure on a real phone first** (Chrome remote debugging, Lighthouse on the live site, mid-range Android, 4G throttling). Everything below should be judged by that number.
2. **Load screens when opened.** Only Home needs to be ready at start. Expense, Personal, Health, Cards and the other `*-ui.js` files could load on first open with dynamic `import()` (already done for OCR). Biggest win; the service worker keeps them cached so later opens are instant.
3. **Check the service worker's first-install download.** Pre-caching every file is good for offline, but it should not compete with the first screen. Cache the rest after the first paint.
4. **Minify.** The files ship as readable source. Minifying typically cuts 35-50% before compression. It needs a small build step, which the project does not have today, so it is a trade-off against simplicity.
5. **Compression and caching headers** on the host (Brotli, long cache for versioned files). Vercel does most of this already; confirm with the live headers.
6. **Reduce work at start.** Avoid reading every store on launch; read only what Home shows.

Risks to watch: lazy loading must not break offline use (every lazily loaded file must be in the service worker's cache list) and must not change the load order the existing tests rely on.
