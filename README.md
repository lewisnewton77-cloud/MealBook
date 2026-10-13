# Mealbook (shared, for two people)

Recipes, shopping list, planner, logbook, Tonight? and Lunch, shared live between two Google accounts.
Nobody else can get in or read the data.

How it fits together
- Netlify hosts the site (`public/`) and two small server functions (`netlify/functions/`).
- Firebase Firestore stores the shared data. Firebase sign-in checks who you are (Google).
- Your two Gmail addresses live in only two places: the Firestore rules (pasted into the Firebase console) and the Netlify setting `ALLOWED_EMAILS`. They are not in any site file.
- Your Anthropic key lives only in the Netlify setting `ANTHROPIC_API_KEY`.

## Setup (about 30 minutes, once)

### 1. Firebase
1. https://console.firebase.google.com -> Add project (Analytics not needed).
2. Build -> **Authentication** -> Get started -> Sign-in method -> enable **Google**.
3. Build -> **Firestore Database** -> Create database -> choose a European location (e.g. `eur3` or `europe-west1`) -> production mode.
4. Project settings (cog) -> General -> Your apps -> add a **Web app** (`</>`). Copy the config values.
5. Open `public/config.js` and replace the four `PASTE_...` values (apiKey, authDomain, projectId, appId). These are safe to be public.
6. Firestore -> **Rules**: open `firestore.rules`, replace the two example addresses with your two Gmail addresses (lowercase), paste the whole file into the console and **Publish**.

### 2. Netlify
Use either route (drag-and-drop does not deploy functions reliably, so avoid it):
- **Git:** put this folder in a private GitHub repository, then Netlify -> Add new site -> Import from Git. `netlify.toml` sets everything.
- **CLI:** `npm i -g netlify-cli`, then `netlify login`, `netlify init`, `netlify deploy --prod`.

Then Site configuration -> **Environment variables**, add:
| Name | Value |
|---|---|
| `FIREBASE_API_KEY` | the same apiKey as in config.js |
| `ALLOWED_EMAILS` | your two addresses, comma separated |
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `ANTHROPIC_MODEL` | optional, defaults to `claude-sonnet-5-5` |

**Redeploy** afterwards so the functions pick the values up.

### 3. Let the site sign in
Firebase -> Authentication -> Settings -> **Authorized domains** -> add your Netlify domain (e.g. `yourname.netlify.app`).

### 4. Use it
Open the site in **Safari or Chrome** (not inside Messenger/Instagram/Gmail in-app browsers: Google blocks sign-in there). Sign in with one of your two accounts. Add to home screen if you like.

## Moving your test data from the old single-file version
In the old file: Backup & data -> Export backup. In the new site: Backup & data -> Restore backup. Done. (Restore replaces everything shared.)

## Troubleshooting
- "Setup needed": `public/config.js` still has PASTE values.
- "This web address has not been added to Firebase": step 3.
- "That Google account is not on this household's list": the Firestore rules do not contain that address (check spelling/lowercase and that you pressed Publish).
- Link import or screenshot says unauthorised/forbidden: `ALLOWED_EMAILS` is missing or you did not redeploy after setting it.
- Screenshot import fails: `ANTHROPIC_API_KEY` missing, or no credit on the Anthropic account.
- Some recipe sites block automated fetching; use a screenshot instead.

## Limits (free tiers)
Firestore free tier (Spark): 1 GiB stored, 50K reads and 20K writes per day, far more than two people need. Photos are stored shrunk inside the recipe, so no paid Storage is needed. The app also works offline in a shop and syncs when you are back online.
