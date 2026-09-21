# MyNotes server (usage analytics)

Receives the app's anonymous usage counts. Financial data never reaches it: `lib/validate.js` rejects any field that is not on its allow-list. It never reads or logs IP addresses and never stores request bodies; the only headers it looks at are `Origin` (CORS) and `Content-Length` (size limit).

- `POST /api/collect` - anonymous counts (install id, features on, plan, app version, platform, time zone, language, optional age band and gender). Replies 204.
- `POST /api/forget` `{ "installId": "..." }` - deletes everything held for that install.
- `GET /api/health` - 200 if the database answers.
- `POST /api/plan` `{ "installId": "..." }` - the app's membership check; returns `{ plan, known }`, read-only.
- `GET /api/admin/installs`, `POST /api/admin/plan` - the admin user list and the paid/free switch (open unless `ADMIN_KEY` is set).

## Set up (free tier)
1. **Database:** create a free TiDB Cloud Starter instance (or any MySQL 8). Copy its connection URL, `mysql://user:pass@host:4000/db`.
2. **Tables:** `cd server && npm install && DATABASE_URL="mysql://..." npm run migrate`
3. **Deploy:** in Vercel, import this repo with **Root Directory = `server`**. Add the environment variables `DATABASE_URL` and `ALLOWED_ORIGINS` (comma-separated origins of the app, e.g. `https://your-app-domain`).
4. **Check:** open `https://<your-project>.vercel.app/api/health` - it should say `ok`.

Vercel Hobby is for non-commercial use only; move to Pro when the app earns revenue.

## Backups and moving to a bigger database
- **Backup any time:** `DATABASE_URL="mysql://..." npm run export` writes `backups/mynotes-YYYY-MM-DD.sql` (all data as INSERTs). Keep copies somewhere private.
- **Move hosts with no data loss:** run `npm run migrate` against the new database (it creates the tables from `schema/*.sql`), load the latest `.sql` export with any MySQL client, then change `DATABASE_URL` in Vercel. Nothing in the code is tied to one provider.
- Schema rules that keep this true: plain MySQL only, one statement per `;`, new changes go in a new numbered file in `schema/` (never edit an applied one).

## Tests
`npm test` (from the repo root or here) - no database needed.

## Environments
This server project and its database are **staging**. Production will be a second Vercel project and a second database with its own environment variables (see `docs/environments.md`). Never point production at this database, and use different secrets in each. `ALLOWED_ORIGINS` must list that environment's own app address.

## Vercel notes
- Deployment retries: the server project only builds when a commit changes something inside `server/`.
- The app address `https://mynote-app-tau.vercel.app` is built in (`server/lib/cors.js`); `ALLOWED_ORIGINS` adds more (for example `http://localhost`, or a new domain). It is cleaned before matching (trailing slash, spaces, quote marks and letter case are ignored), so `https://your-app.vercel.app/` still works. Use the exact address of the app, with `https://`.
- Changing an environment variable only takes effect on a **new deployment**. Push a commit that touches `server/` (or use Redeploy).
- The free Hobby plan allows about 100 deployments a day. Every push builds the app project too, so batch pushes on busy days.

## News Feed proxy
`GET /api/news?name=<company>&installId=<id>&since=<YYYY-MM-DD>` is how the app gets Feed news. The Marketaux key lives **only** here, in `MARKETAUX_KEY`; the app never sees it. A key shipped to the app would be readable in devtools, and one shared free-tier key (100 requests a day) would be spent by the first few people to open the Feed.

- **Archive, not just a cache.** `news_archive` holds one row per company per day for about ten days (`ARCHIVE_DAYS` in `lib/news.js`). Today's row saves an upstream call; the older rows are what somebody who has not opened the app for four or five days gets back, so a quiet week leaves no hole in their Feed. `since` is clamped into that window rather than refused.
- **Provider backoff.** When the provider refuses (quota spent, key rejected, outage) that is remembered for `PROVIDER_BACKOFF_MS` (30 min) in `news_state`, and no call is made meanwhile. Without it every sync from every phone keeps asking a provider that is already saying no, and each refusal still counts against the daily allowance. A call that works clears it at once.
- **Quota.** `DAILY_LIMIT` upstream calls per install per day; a day already in the archive does not count. When the limit or the provider is hit the endpoint still returns **200** with the archived days and `limited: true`, so the Feed shows saved news and says today's is not in yet. Buying a paid provider tier is one environment variable and one number here - no code change.
- **Popularity.** `stock_usage` answers "which companies do people follow, and how many follow each". It stores no install id: `follower` is a one-way hash of the install id, `NEWS_HASH_SECRET`, the week **and** the company. So the same person is a different value every week (weeks cannot be joined) and a different value for every stock (rows cannot be grouped into anybody's holdings), while `COUNT(DISTINCT follower)` within one week is still exactly the number of people. With no `NEWS_HASH_SECRET` set, nothing is recorded at all.
- In the app the Feed is **Pro Plan only** and **off until switched on**, for Pro members too.

### Environment
| Variable | Purpose |
|---|---|
| `MARKETAUX_KEY` | The news provider key. Without it `/api/news` returns 503 and the Feed shows saved news only. |
| `NEWS_HASH_SECRET` | Long random string. Without it the "companies followed" figures are not collected. Changing it resets those counts, which is the intended way to wipe them. |

## Dashboard
`/admin` (`public/admin.html`) shows aggregate analytics across four tabs. It reads `GET /api/stats`, which returns **counts only** - no install ids, no row-level data, and age is never cross-tabulated with gender or region, so no individual can be identified. The page is public and marked `noindex`; responses are cached at the edge for 5 minutes so it cannot burn the database quota.

- **Overview** - headline counts, plus:
  - *Daily active*, one point per day for the last 30, drawn as an inline SVG line (no chart library). Needs the `install_days` table; without it the panel says so instead of failing.
  - *Stickiness*, active today against active this month: the habit number.
  - *Retention by joining week*, how many of each week's arrivals still opened the app in the last 7 days.
  - *Update health*, the share on the newest `app_version` and how many are three or more behind - whether the service worker's update path is landing.
  - *Lapsed* now separates the newly quiet (gone 30-60 days) from the long gone.
- **Features** - ranking, *Free plan against Pro* (each side a share of its own group, since the two differ in size), free-plan pressure, feature pairs. Every row carries the app's own icon; `NAMES` and `ICONS` in the page mirror `APP_MODULES` in `app.js`, and `test/admin.test.js` fails if a feature in `lib/validate.js` is missing from either.
- **Stocks & News** - how healthy the news side is: companies and days archived, upstream requests spent today (against the provider's daily allowance), whether the provider is cooling off after a refusal, and when news was last fetched; plus *Companies followed* (people per company this week, never who follows what). Reads `news_archive`, `news_quota` and `news_state`, each allowed to fail quietly on a database that has not used the Feed yet.
- **People** - age, gender, platform, version, region, language.
- **Users** - the one row-level surface, one card per install (plan icon, seen/joined in plain words, freshness dot, device and feature chips). Filter with chips for plan, last seen and device, search by install-id prefix, and sort. Filters are applied in SQL from an allow-list with bound parameters (`listSql` in `lib/installs.js`); anything unrecognised is dropped rather than refused.
