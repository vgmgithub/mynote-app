# Environments: staging now, production later

Status: staging exists and is what runs today. Production is not created yet. Written 21 Sep 2026.

## The decision
The **current address and database are the development / staging environment**. A separate production
environment (new domain, new database, live payment keys) is created later, when the domain is chosen.
The app and the server each get a production copy; nothing is shared between staging and production.

| | Local | Staging (today) | Production (later) |
|---|---|---|---|
| App address | `http://localhost` | `mynote-app-tau.vercel.app` | the new domain |
| Server | staging server | `mynotes-server.vercel.app` | a new Vercel project, its own address |
| Database | test DB (`?testdb=1`) or staging | the current TiDB database | a **new** database |
| Git branch | any | `main` | `production` |
| Payments | none | Razorpay **test** keys | Razorpay **live** keys |
| Real users | no | you and testers | everyone |

## How the app knows where it is
`config.js` decides from the **address the app is opened from**, not from a setting anyone could forget:
`localhost` is local, a listed production host is production, and **everything else is staging**. Each
environment gets its own server address. Nothing else in the code names a server; a test
(`tests/unit/config.test.js`) fails if any module does.

Two safety rules are built in:
- A production copy with **no production server configured has no server**. It does not fall back to
  staging, because that would write real users' counts and payments into the test database.
- Anything that is not production shows its environment next to the version on Home (for example
  `v722 · staging`), so a test copy is never mistaken for the real app.

Browser data belongs to the address, so staging and production cannot see each other's data either.

## Day-to-day
Nothing changes yet. Work is committed and pushed to `main`, which deploys to staging. Vercel builds every
push to a branch, so a busy day still counts toward the free plan's deployment cap.

## Releasing to production (once it exists)
1. Make sure the tests are green on `main` (the GitHub Actions run, or `npm test` locally).
2. Check the change on staging.
3. Release: `git checkout production && git merge --ff-only main && git push && git checkout main`.
4. The production Vercel project builds from the `production` branch only.
5. Apply any new `server/schema/*.sql` to the **production** database (`DATABASE_URL=... npm run migrate`)
   *before* releasing code that needs it. Staging got it first.
6. Roll back by promoting the previous deployment in Vercel, or `git revert` on `main` and release again.

Do not commit straight to `production`.

## Chosen addresses (21 Sep 2026)
The owner's domain is `viewsofvgm.com` (bought; the `.app` idea was dropped). Planned production addresses:

| What | Address |
|---|---|
| App | `https://mynotes.viewsofvgm.com` |
| Server (API) | `https://api.viewsofvgm.com` |
| Root of the domain | a small page for the maker, linking MyNotes and the policy pages (gateways and Play look at it) |
| Support email | `viewsofvgm@gmail.com` (already `LEGAL_CONTACT`). A domain address can replace it later. |

Staging stays on the existing `vercel.app` addresses.

The app address contains the app name. Renaming the app later means changing the subdomain, which is a new
address and so a backup-and-restore move for every user (`docs/android-migration.md`). A name-neutral
subdomain such as `app.viewsofvgm.com` would avoid that; the owner chose `mynotes.`.

`config.js` now holds `PRODUCTION_HOSTS = ['mynotes.viewsofvgm.com']` and
`PRODUCTION_SERVER = 'https://api.viewsofvgm.com'`.

## Setting production up (checklist, when the domain is chosen)
1. **Domain.** Buy it. See `docs/android-migration.md`: the address decides where users' data lives, so choose
   the name first (the name "MyNotes" is generic; see the ratings notes).
2. **New Vercel project for the app** from this repo, production branch `production`, domain attached.
3. **New Vercel project for the server**, Root Directory `server`, production branch `production`, on its own
   address (an `api.` subdomain of the new domain is tidy).
4. **New database** (a second TiDB instance, or a separate database in the same cluster). Run
   `npm run migrate` against it. Never point production at the staging database.
5. **Server environment variables** on the production server project (Production scope):
   `DATABASE_URL`, `ALLOWED_ORIGINS` (the production app address), `ADMIN_KEY`, `MARKETAUX_KEY`,
   `NEWS_HASH_SECRET` (a new one), and later the live Razorpay keys and webhook secret.
   Use different values from staging for everything secret.
6. **`config.js`:** set `PRODUCTION_HOSTS` to the production hostname(s) and `PRODUCTION_SERVER` to the
   production server address. Update `server/lib/cors.js` `DEFAULT_ORIGINS` or rely on `ALLOWED_ORIGINS`.
7. **Move your own data.** Your personal data lives on the staging address. Make a backup there and restore it
   on production, then re-grant your Pro installs from the admin page (the install id is per address).
8. **Existing testers:** show a "we have moved" banner on staging pointing to production, with the backup
   step, per `docs/android-migration.md`.
9. **Android:** the wrapper points at production only.

## Vercel walkthrough (production)
Labels in the Vercel dashboard change over time, so treat the names below as a guide. In this order:

1. **Buy the domain in Vercel.** Domains (team level) > Buy, search `viewsofvgm.com`, pay. Vercel then manages its DNS,
   so the records for the two subdomains are added for you when you attach them to a project.
2. **New database.** In TiDB Cloud, create a second Starter cluster (or a second database, for example `mynotes_prod`,
   with its own user). Copy its connection URL and keep it out of chat and out of git.
   Then: `cd server && DATABASE_URL="mysql://..." npm run migrate`.
3. **Create the branch.** `git branch production main && git push -u origin production`.
4. **Production server project.** Add New > Project > import this repo, name it `mynotes-server-prod`,
   **Root Directory = `server`**. Settings > Git > Production Branch = `production`.
   Settings > Domains: add `api.viewsofvgm.com`.
   Settings > Environment Variables (Production scope): `DATABASE_URL` (the new one), `ALLOWED_ORIGINS`
   (`https://mynotes.viewsofvgm.com`), `ADMIN_KEY`, `MARKETAUX_KEY`, `NEWS_HASH_SECRET` (a new random value).
   Redeploy so the variables take effect. Check `https://api.viewsofvgm.com/api/health` says `ok`.
5. **Production app project.** Add New > Project > the same repo, name it `mynote-app-prod`, Root Directory left as
   the repo root, Production Branch = `production`. Settings > Domains: add `mynotes.viewsofvgm.com`.
6. **Point the app at the server.** In `config.js` set `PRODUCTION_HOSTS = ['mynotes.viewsofvgm.com']` and
   `PRODUCTION_SERVER = 'https://api.viewsofvgm.com'`. Commit to `main`, check it on staging, then release:
   `git checkout production && git merge --ff-only main && git push && git checkout main`.
7. **Verify.** Open the production address: the version line shows no environment suffix. The admin page on
   `https://api.viewsofvgm.com/admin` asks for the key and shows an empty database.
8. **Move your data.** Backup on the staging address, restore on production, then re-grant your Pro installs from the
   production admin page.

Plan note: Vercel's free Hobby plan is for non-commercial use. Move the two production projects to the paid plan
before they take payments.

## Build control (keeps the deployment count down)
Four Vercel projects build from this one repo, and Vercel's Hobby limit is **100 deployments per 24 hours for the whole
account**, shared by all four (also 100 per hour and 60 per 5 minutes). Researched 23 Sep 2026 from vercel.com/docs/limits
and the Ignored Build Step docs:

- **A skipped build still counts.** A deployment cancelled by the Ignored Build Step (`scripts/vercel-ignore.js`) is counted
  as a full deployment. So the script saves build time, not quota: every push to `main` costs **4** (staging app, staging
  server, and the two production projects building or cancelling a preview).
- **A refused deployment is not retried.** When the limit is hit, GitHub shows "Deployment rate limited - retry in 24 hours"
  and the commit is simply not deployed. After the window resets, deploy it again: Vercel project > Deployments >
  Create Deployment > enter `main` (or the commit SHA), for the staging app and the staging server. A new push also works.
  "Redeploy" on an old entry rebuilds that entry's own (older) commit, not the latest one.
- The window is 86400 seconds from when it started, not a calendar day.

What actually lowers the count:
1. **Until production goes live, disconnect Git from the two production projects** (Vercel > project > Settings > Git >
   Disconnect). A disconnected project creates no deployment at all, so a push costs 2 instead of 4. Reconnect them when the
   owner says "move to prod". (`git.deploymentEnabled` in `vercel.json` cannot do this: the staging and production app share
   the repo-root `vercel.json`, and the two servers share `server/vercel.json`.)
2. **Push in batches**, one push per finished feature. 23 Sep 2026: about 25 pushes x 4 used the whole day.

| Project | Builds | How |
|---|---|---|
| Staging app (`mynote-app`) | `main` | production branch `main`; `scripts/vercel-ignore.js` skips previews and docs/server-only changes |
| Production app (`mynote-app-prod`) | `production` | production branch `production`; same script. Disconnect Git until release |
| Staging server (`mynotes-server`) | `main` | production branch `main` |
| Production server (`mynote-server-prod`) | `production` | production branch `production`. Disconnect Git until release (it was building every push to `main`) |

The script diffs against the last successfully deployed commit (`VERCEL_GIT_PREVIOUS_SHA`), so a push after a refused
deployment still builds everything since the last good one. If the diff cannot be worked out it builds.

## What to confirm with Vercel
Stated from memory of Vercel's docs, so check before relying on them:
- The free Hobby plan is for non-commercial use. A production app that takes payments needs the paid plan.
- Environment variables can have separate values for Production and Preview.
- Whether the automatic `*.vercel.app` address can be reassigned away from the production branch. It does
  not matter for this plan: staging simply stays on it.

## Rules for production data (standing, set by the owner on 21 Sep 2026)

**Objective: nothing an assistant does may ever change the production database.**

1. **Work only on `main`.** Staging (`main`, the `vercel.app` addresses and the staging database) is where all
   changes go. Nothing is merged into `production` until the owner says "move to prod".
2. **Before any merge to `production`, protect the production database first.** State in writing, and wait for the
   owner's go: which `server/schema/*.sql` files changed since the last release, whether each is additive, what
   server code writes to the database and whether it works on the *unmigrated* production schema, and anything
   that could touch existing rows. Schema changes are applied to production by the owner, never by an assistant.
3. **After the owner says "published", production data is read-only for the assistant, permanently.** Allowed:
   `SELECT`, `GET /api/health`, `GET /api/stats`, `POST /api/plan` (a read). Not allowed on production: any
   `INSERT`, `UPDATE`, `DELETE`, seeding, migration, or a call that writes as a side effect.
4. **Side-effect writes count.** These endpoints write, so they are never called against `api.viewsofvgm.com`:
   `/api/news` (archive, quota and follower rows), `/api/collect`, `/api/forget`, and the admin plan endpoint.
   Test them on staging.
5. **The assistant does not hold the production `DATABASE_URL`** and must not ask for it or accept it in chat.
   Secrets live only in the Vercel production project.
6. Before "published" the production database may be exercised for initial testing, and only with the owner's
   say-so for each step.

`server/scripts/migrate.js` also refuses to write until the target host is named (`CONFIRM_DB_HOST`), so a leftover
URL cannot point a migration at the wrong database by accident.

## Not done yet
- No production project, domain or database exists.
- Payments are not built (see the payments plan).
- The GitHub Actions workflow reports test results; it does not block Vercel from deploying. Only release
  from a green `main`.

## Stocks & News: syncing on demand (admin v17)
The admin page's Stocks tab has "Sync India" / "Sync US" buttons, each showing how many followed companies have not
been checked *at all* today (a cron miss, or a company somebody just started following mid-day). A click reuses the
exact sweep the daily cron runs (`server/api/cron-news.js`, `?trigger=admin`, checked against ADMIN_KEY the same way
every other admin write is): most-followed first, stopped by the market's own share of `NEWS_DAILY_BUDGET`. It never
re-fetches a company already checked today, so pressing it twice, or pressing it after the cron already ran, can only
finish today's remaining work sooner - never spend the day's allowance twice. Disabled (shown as "✓ done") once
nothing is left for that market.
