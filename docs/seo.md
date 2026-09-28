# SEO

Status: meta data added 28 Sep 2026, ahead of a real marketing push. Nothing here changes the app's UI
or behaviour — it is entirely `<head>` tags, plus two static files search engines read on their own
(`robots.txt`, `sitemap.xml`).

## What was added

- **`index.html`** (the landing page, and the app shell): a real `<title>`, a meta description built from
  the landing hero's own copy, Open Graph and Twitter Card tags (so a shared link gets a proper preview
  card), and a `SoftwareApplication` JSON-LD block stating only what the Free Plan actually is (5
  features, free forever) — never a claim the app itself doesn't make.
- **`privacy.html`**: its own title, description and canonical link, so it can rank on its own rather
  than as an unlabelled page.
- **`robots.txt`** and **`sitemap.xml`**: static files at the repo root, referencing the planned
  production address (`https://mynotes.viewsofvgm.com`, `docs/environments.md`). Inert until that domain
  is actually live; nothing here needs to change when it is.

## The one thing that had to be environment-aware: not indexing staging

`index.html` and `privacy.html` are the same files on every environment (local, staging, production) —
there is no per-environment build. A search engine finding and indexing the staging URL
(`mynote-app-tau.vercel.app`) would be a real problem: duplicate content, and a test copy of the app
turning up in search results.

So `<meta name="robots">` **defaults to `noindex, nofollow`**, statically, in both HTML files. `seo.js` —
loaded the same way `env-icons.js` already is, from the same `config.js` `IS_PRODUCTION` — relaxes it to
`index, follow` on the one host that is actually production. Everywhere else, the tag never changes.

`robots.txt` itself stays permissive everywhere (it cannot be environment-specific — see the comment in
the file for why a blanket `Disallow` there would be the wrong fix). The `noindex` meta tag is the real
gate.

## Not done

- **No Open Graph / Twitter image sized for social sharing.** `og:image` / `twitter:image` currently
  point at `icons/icon-512.png` (square) — better than nothing, but a proper 1200×630 banner would look
  right when a link is shared on WhatsApp, Twitter/X, etc.
- **No sitemap entries beyond `/` and `/privacy.html`** — there is nothing else public to list yet.
- **No analytics / Search Console verification tag** — add one when the owner sets up Search Console for
  the real domain.
