# Moving existing PWA users to the Android app

Status: a plan, not built. Written 21 Sep 2026. Nothing here changes the data schema or the backup format.

## The problem
A PWA keeps its data in the browser's storage for one web address (`mynote-app-tau.vercel.app`): the IndexedDB database `mynote-app`, plus a little local storage. An Android app is a different sandbox with its own storage. The two cannot see each other's data.

The server cannot help either. By design it holds only anonymous usage counts (install id, plan, features, version, days opened). It never had anybody's money data, so there is nothing on it to fetch back. That is the privacy promise, and it is also why the server is not a migration route.

## Options

| Route | How it works | Pros | Cons |
|---|---|---|---|
| **A. Trusted Web Activity (TWA)** | Package the same site as an Android app. It loads the live PWA in a full-screen Chrome view and is listed on Google Play. | Same web address, so the same browser storage: existing data carries over with no migration step. One code base, and the update flow and service worker keep working. | It is still the web app in Chrome. It can only reach the native side through web APIs. Users need Chrome installed. Moving to a native app later would need a real migration. |
| **B. Backup file** | The user makes a backup in the PWA and restores it in the new app. The format is stable and old backups still import. | Works today with nothing new to build. No data leaves the phone. Also the fallback for a phone change. | Manual, so some people will not do it, and anything added after their last backup is lost. |
| **C. Server transfer** | The old app uploads the data, the new app downloads it. | Smoothest for the user. | Puts personal finance data on our server, which breaks "your data never leaves this device" and changes the Privacy text, Terms and the Play data-safety answers. Only defensible end-to-end encrypted with a code only the user holds, and it still makes the server a target. **Not recommended.** |
| **D. Native app with an import** | A real Android app (for example Capacitor) with its own storage, plus a one-tap "bring my data over". | Full native features (notifications, biometrics, widgets). | Highest effort and the highest migration risk. Needs the backup route to be excellent. |

## Recommendation
Ship as a **TWA (A)**, with the **backup file (B)** as the safety net.

- Data moves with the user, because the address and storage are unchanged.
- The install id lives in the same storage, so a Pro member stays Pro with no extra work.
- The privacy promise stays intact, and the server needs no new capability.
- If a native app is wanted later, add a clearly labelled "Export for the new app" file at that point. Do not upload data to the server.

## What to check before release
1. **Same origin.** The TWA must load exactly the address users already use. A new domain would start empty. If the domain ever changes, every user must be told to back up first, because browser storage does not follow a domain.
2. **Digital Asset Links.** Host the `assetlinks.json` file so Chrome opens the site full-screen, without a browser bar, inside the app.
3. **Storage on the TWA.** Confirm in a test install that the existing PWA data appears in the TWA. This is the one thing to test with real data before publishing.
4. **Backup reminder first.** Before the listing goes live, ship an in-app nudge to make a backup. It costs nothing and covers the unexpected.
5. **Landing page and install guide.** Add "Install from Google Play" beside the current install steps. The PWA keeps working, so nobody is forced across.

## Google Play policy (unverified)
Not checked against Google's current wording, so confirm before publishing. Google generally requires a privacy policy and a Data safety form. The server holds no money data, which keeps the form short. Uploading user data (option C) would raise the requirements considerably. The Terms and Privacy text should get the lawyer review already on the open-items list before the listing.

## Open decisions
- Ship the TWA first, or go straight to a native app?
- Timing of the backup nudge (before or with the listing).
- Whether the Play listing is free while Pro is still not on sale. Play's payment rules apply once Pro can be bought in the app, and that path is not built yet.
