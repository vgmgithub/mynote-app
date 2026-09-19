# MyNotes server (usage analytics)

Receives the app's anonymous usage counts. Financial data never reaches it: `lib/validate.js` rejects any field that is not on its allow-list. It never reads or logs IP addresses and never stores request bodies; the only headers it looks at are `Origin` (CORS) and `Content-Length` (size limit).

- `POST /api/collect` - anonymous counts (install id, features on, plan, app version, platform, time zone, language, optional age band and gender). Replies 204.
- `POST /api/forget` `{ "installId": "..." }` - deletes everything held for that install.
- `GET /api/health` - 200 if the database answers.

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
