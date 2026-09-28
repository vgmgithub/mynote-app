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

## Update, 28 Sep 2026: a home-screen widget rules out the TWA

The owner asked for "a pure Android app" with a home-screen widget. A widget is a real native Android
surface (`AppWidgetProvider`, drawn with `RemoteViews`) - there is no web API for it at all, in a TWA or
anywhere else. **Option A (TWA) cannot do this, full stop**, no matter how it is configured. This one
requirement moves the recommendation to **Option D, built with Capacitor** - not a rewrite: the existing
`app.js`/`personal-ui.js`/etc. ship unchanged inside a native shell, and the widget is the one genuinely
new piece of native code.

### Why Capacitor and not a full native rewrite
Capacitor packages the existing web app (all of it - same IndexedDB, same service worker, same files)
inside a native WebView, and lets native Kotlin code sit alongside it. That keeps everything this project
already has - every screen, the offline-first design, the backup format, the whole feature set - and
adds only what a browser genuinely cannot provide: the widget, and later, notifications or biometrics if
wanted. A full native rewrite would throw all of that away to rebuild it in Kotlin from scratch.

### What has to be true about the widget before any code is written
A widget cannot show "whatever the app happens to be showing" - it runs outside the WebView, with no
live access to IndexedDB. It shows whatever was last **pushed** to it. So a decision is needed first:
**what does the widget show?** (Days left / budget remaining, like Home's own summary? Portfolio value?
Something else?) That decision shapes exactly one new bridge (see step 8 below) and nothing else in the
app changes to support it.

### Steps

| # | Step | Who does it |
|---|---|---|
| 1 | Add Capacitor to the repo (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`), point it at the existing files as the bundled web assets - no build step is added, since this app already ships as plain JS/CSS/HTML | me |
| 2 | `npx cap add android` - generates the native Android Studio project | me (the command), then it opens in **your** Android Studio |
| 3 | First Gradle sync and a debug build, confirm the app opens and the existing screens/IndexedDB work inside Capacitor's WebView | **you**, in Android Studio - I cannot run Gradle or a device/emulator from here |
| 4 | Fix whatever the first real build surfaces (Capacitor's WebView occasionally needs a manifest or plugin tweak the docs don't mention) | back-and-forth: you paste the error, I patch |
| 5 | Decide the widget's content (see above) | **you** |
| 6 | Write the native widget: `AppWidgetProvider` (Kotlin), its layout XML, `widget_info.xml`, the manifest `<receiver>` entry | me |
| 7 | Write the bridge: a small custom Capacitor plugin so `app.js` can call e.g. `Widget.update({...})` whenever Home renders, which the native side stores and pushes to the widget | me |
| 8 | Build, add the widget from the home screen's widget picker, confirm it renders and updates | **you** |
| 9 | Iterate on anything step 8 finds | back-and-forth |
| 10 | *(Only if publishing)* Play Console listing, Data safety form, signing, review queue | **you** (review turnaround is Google's, not ours - hours to days, outside anyone's control) |

### The honest token/effort estimate
Steps 1, 2, 6 and 7 are bounded - similar in size to a large feature already shipped this session, so a
few hundred thousand tokens across a couple of focused turns is a reasonable first-pass estimate for the
code itself.

**What actually drives the total is steps 3, 4, 8 and 9 - and those I cannot estimate honestly, because I
cannot compile or run a Gradle/Android build in this environment at all.** Every other feature this
session was verified directly (unit tests, a live browser). A native Android build has no equivalent
here: I write the Kotlin/XML/config, you build it in Android Studio, and only your build output tells
either of us if it's right. First-time Capacitor + a custom native plugin commonly takes 2-4 rounds of
"here's the Gradle/Kotlin error" -> fix -> rebuild even for an experienced Android dev; each round costs
whatever it costs to read your error and patch it, which is small per round but unbounded in round count.

**Plain answer: cheap and fast for the code, open-ended for the build loop**, because that part depends on
your machine's Android Studio/SDK state, not on anything I can control or predict from here.
