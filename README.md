# Reelscore: free hosting, step by step

Three free services, no credit card, no coding tools, all in the browser:

| What | Service | Free allowance |
|---|---|---|
| The website (`yourname.netlify.app`) | **Netlify Drop** | 100 GB bandwidth/month |
| Google sign-in + database (titles, verdicts, reviews, lists) | **Firebase, Spark plan** | 50,000 reads and 20,000 writes per day |
| Posters, banners, trailer clips, cast photos | **Cloudinary, Free plan** | 25 credits/month; images up to 10 MB, videos up to 100 MB |

Time: about 25 minutes.

---

## Step 1: Create the Firebase project (database + sign-in)
1. Go to **console.firebase.google.com** and sign in with Google.
2. Click **Create a project** (or **Add project**). Name it `reelscore` → Continue. Google Analytics: **off** → **Create project** → Continue.
3. Left menu **Build → Authentication → Get started** → under *Sign-in method* click **Google** → turn **Enable** on → choose your support email → **Save**.
4. Left menu **Build → Firestore Database → Create database**:
   - Edition **Standard**, location **asia-south1 (Mumbai)** → Next
   - **Start in production mode** → **Create**.
5. Still in Firestore, open the **Rules** tab. Delete everything there, paste in the full contents of **`firestore.rules`** from this folder, and click **Publish**.

Don't upgrade to Blaze. Nothing here needs it.

## Step 2: Put your Firebase keys in the site
1. In Firebase, click the **⚙︎ gear → Project settings**.
2. Under **Your apps**, click the **`</>`** (Web) icon. App nickname `reelscore`, leave *Firebase Hosting* **unticked** → **Register app**.
3. You'll see a block like `const firebaseConfig = { apiKey: "...", ... }`. Copy those values.
4. Open **`firebase-config.js`** in this folder with any text editor (Notepad, TextEdit) and replace each placeholder with your value. Keep the quotes. Save.

These values are meant to be public. Your data is protected by the rules you published in step 1.

## Step 3: Put the site online with Netlify Drop
1. Go to **app.netlify.com/signup** and sign up free (Google or GitHub). Sign up *before* dropping: drops without an account are deleted within an hour.
2. Go to **app.netlify.com/drop**.
3. Drag the whole **`reelscore-free`** folder (the one containing `index.html`) onto the page. Wait a few seconds.
4. You'll get an address like `https://silly-name-12345.netlify.app`.
5. Optional, for a nicer name: **Project configuration → Change project name** → `reelscore` (if free) gives `https://reelscore.netlify.app`.
6. **Allow sign-in from this address.** In Firebase: **Authentication → Settings → Authorized domains → Add domain** → enter just the host, e.g. `reelscore.netlify.app` → Add.

## Step 4: Set up free media uploads (Cloudinary)
1. Sign up free at **cloudinary.com** (no card needed).
2. On the dashboard, note your **Cloud name** (for example `dxyz123ab`).
3. Click the **⚙︎ Settings** gear → **Upload** → **Upload presets** → **Add upload preset**:
   - **Upload preset name:** something hard to guess, e.g. `reel_8f3k2q`
   - **Signing mode:** **Unsigned**
   - **Asset folder:** `reelscore`
   - Under *Upload Control* (or *Restrictions*): **Allowed formats** `jpg,jpeg,png,webp,mp4,webm`, and **Max file size** `20000000`
   - **Save.**
4. Back in Firebase **Firestore Database → Data → + Start collection**:
   - Collection ID: `private` → Next
   - Document ID: `media`
   - Field `cloudName` · string · *your cloud name*
   - **Add field** → `uploadPreset` · string · *your preset name* → **Save**

Only admins can read this document, so visitors never see your preset name.

## Step 5: Make yourself admin and load the catalogue
1. Open **`https://<your-site>.netlify.app/setup.html`**.
2. **Sign in with Google.** The page shows **your user ID** with a Copy button.
3. In Firebase **Firestore Database → Data → + Start collection**:
   - Collection ID: `admins` → Next
   - Document ID: paste your user ID
   - Field `role` · string · `owner` → **Save**
4. Back on the setup page click **Check again**. Steps 2 and 3 turn green.
5. Click **Load 40 starter titles**. Wait for "✓ Loaded 40 titles".
6. Open your site. You'll see the home page, and **Admin** in the menu. Add posters, banners, trailer clips and cast photos there, and choose the home banner titles.

You're live. 🎉

---

## Updating the site later
Changes to titles, images and the banner happen in **Admin**, live, with no redeploy.

If you change any *files* (for example a new version of `index.html` from me): Netlify → your project → **Deploys** → drag the updated folder onto the box that says *"Need to update your project? Drag and drop your project output folder here"*.

## Adding another admin
They sign in once at `/setup.html` and copy their user ID. You add a document with that ID to the `admins` collection, as in step 5.

## What carried over from the prototype
- **Carried over:** all 40 titles (synopsis, cast, dates, sections, OTT platforms, YouTube links) and the home banner list.
- **Not carried over:**
  - Images, clips and cast photos uploaded in the prototype. They're stored inside claude.ai and can't be exported, so re-upload them in Admin.
  - Test verdicts and reviews.

Titles without art show a coloured placeholder.

## Limits to know
- **Firebase free plan:** each visit reads roughly 50–150 documents, so the free plan is comfortable for a few hundred visitors a day. If you outgrow it, upgrading to Blaze is pay-as-you-go and the free allowance still applies.
- **Cloudinary:** 25 credits/month. A handful of trailer clips watched often is what uses them fastest. Keep clips short (1–2 minutes, 720p), or link YouTube trailers in the title's Videos instead.
- **Privacy:**
  - People who sign in have their Google name and photo shown publicly, so friends can follow each other.
  - My List, follows and reminders stay private.
  - Before a public launch, add a privacy policy and terms (India's DPDP Act applies).
- **Rights:** only upload posters and clips you have the rights to use.

## Files
```
index.html            the site
setup.html            one-time setup page (/setup.html)
firebase-config.js    your Firebase keys (step 2)
firestore.rules       paste into Firestore → Rules (step 1)
js/                   connects the site to Firebase and Cloudinary
data/                 starter titles loaded by setup.html
```

## Search engine pages (build step)

Vercel runs `node scripts/build.mjs` on every deploy. It reads the catalogue from Firestore and writes `dist/`:
a pre-rendered page for every title (`/movie/…`, `/tv/…`) and for every person with at least 2 titles (`/person/…`),
each with its own title, description, canonical link, Open Graph tags and schema.org data, plus `sitemap.xml` and `robots.txt`.
The app loads on top of these pages exactly as before. Anything not pre-rendered still falls back to `index.html`.

Optional Vercel environment variables: `SITE_URL` (canonical origin), `SEO_MIN_VERDICTS` (default 10: a title's score only
goes into search markup once it has this many verdicts), `SEO_MIN_CREDITS` (default 2).
Pages reflect the catalogue at deploy time, so redeploy after big catalogue changes. Test locally with
`FIXTURE=file.json node scripts/build.mjs` where the file holds `{movies, people, verdicts}`.
