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

## Vercel notes
- Deployment retries: the server project only builds when a commit changes something inside `server/`.
- The app address `https://mynote-app-tau.vercel.app` is built in (`server/lib/cors.js`); `ALLOWED_ORIGINS` adds more (for example `http://localhost`, or a new domain). It is cleaned before matching (trailing slash, spaces, quote marks and letter case are ignored), so `https://your-app.vercel.app/` still works. Use the exact address of the app, with `https://`.
- Changing an environment variable only takes effect on a **new deployment**. Push a commit that touches `server/` (or use Redeploy).
- The free Hobby plan allows about 100 deployments a day. Every push builds the app project too, so batch pushes on busy days.

## Dashboard
`/admin` (`public/admin.html`) shows aggregate analytics across four tabs. It reads `GET /api/stats`, which returns **counts only** - no install ids, no row-level data, and age is never cross-tabulated with gender or region, so no individual can be identified. The page is public and marked `noindex`; responses are cached at the edge for 5 minutes so it cannot burn the database quota.

- **Overview** - headline counts, plus:
  - *Daily active*, one point per day for the last 30, drawn as an inline SVG line (no chart library). Needs the `install_days` table; without it the panel says so instead of failing.
  - *Stickiness*, active today against active this month: the habit number.
  - *Retention by joining week*, how many of each week's arrivals still opened the app in the last 7 days.
  - *Update health*, the share on the newest `app_version` and how many are three or more behind - whether the service worker's update path is landing.
  - *Lapsed* now separates the newly quiet (gone 30-60 days) from the long gone.
- **Features** - ranking, *Free plan against Pro* (each side a share of its own group, since the two differ in size), free-plan pressure, feature pairs. Every row carries the app's own icon; `NAMES` and `ICONS` in the page mirror `APP_MODULES` in `app.js`, and `test/admin.test.js` fails if a feature in `lib/validate.js` is missing from either.
- **People** - age, gender, platform, version, region, language.
- **Users** - the one row-level surface. Filter by plan, activity, platform and install-id prefix, and sort. Filters are applied in SQL from an allow-list with bound parameters (`listSql` in `lib/installs.js`); anything unrecognised is dropped rather than refused.
