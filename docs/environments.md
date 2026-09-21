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

## What to confirm with Vercel
Stated from memory of Vercel's docs, so check before relying on them:
- The free Hobby plan is for non-commercial use. A production app that takes payments needs the paid plan.
- Environment variables can have separate values for Production and Preview.
- Whether the automatic `*.vercel.app` address can be reassigned away from the production branch. It does
  not matter for this plan: staging simply stays on it.

## Not done yet
- No production project, domain or database exists.
- Payments are not built (see the payments plan).
- The GitHub Actions workflow reports test results; it does not block Vercel from deploying. Only release
  from a green `main`.
