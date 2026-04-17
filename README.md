# MediTrack

A production-grade medicine reminder app with adaptive adherence analytics, Firebase Phone OTP auth, and monetization via in-app purchases.

---

## Architecture overview

```
MedicineTracker/
├── backend/          Fastify API server (TypeScript, PostgreSQL)
├── database/         SQL migrations (run in order 001→011)
├── src/              React Native mobile app
│   ├── api/          API client (auto-attaches Firebase tokens)
│   ├── design/       Tokens + shared UI components
│   ├── navigation/   Auth / Main / Root navigators
│   ├── screens/      All 9 screens
│   ├── services/     Notification engine, scheduler, storage
│   └── store/        Zustand stores (auth, medicines, billing)
├── android/          Android native project
├── ios/              iOS native project (generated on first run)
└── .github/          CI/CD workflows
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| npm | 9+ | bundled with Node |
| PostgreSQL | 15+ | `brew install postgresql@15` |
| React Native CLI | latest | `npm install -g react-native-cli` |
| Android Studio | latest | [developer.android.com](https://developer.android.com/studio) |
| Xcode | 15+ | Mac App Store |
| Railway CLI | latest | `npm install -g @railway/cli` |

---

## Step 1 — Firebase project setup

### 1.1 Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it `MediTrack` → create
3. In the left sidebar go to **Authentication** → **Sign-in method**
4. Enable **Phone** as a sign-in provider → Save

### 1.2 Android app — `google-services.json`

1. In Firebase console, click **Add app** → Android
2. Package name: `com.medicinetracker` (must match `android/app/build.gradle`)
3. Download `google-services.json`
4. Place it at: `android/app/google-services.json`

> This file is in `.gitignore` — never commit it.

### 1.3 iOS app — `GoogleService-Info.plist`

1. In Firebase console, click **Add app** → iOS
2. Bundle ID: `com.medicinetracker` (must match your Xcode target)
3. Download `GoogleService-Info.plist`
4. After running `npx react-native run-ios` (Step 5), drag this file into your Xcode project root

> This file is in `.gitignore` — never commit it.

### 1.4 Backend service account

1. Firebase console → **Project settings** → **Service accounts**
2. Click **Generate new private key** → download JSON
3. From the JSON, copy three values into `backend/.env`:

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n"
```

> Replace each `\n` in the private key with a literal `\n` character — do not use real newlines in the `.env` file.

---

## Step 2 — Database setup

### 2.1 Local PostgreSQL

```bash
# Create database
createdb medicine_tracker

# Copy env file and set DATABASE_URL
cp backend/.env.example backend/.env
# Edit backend/.env and set:
# DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/medicine_tracker
```

### 2.2 Run migrations

```bash
cd backend
npm install
npm run migrate
```

Migrations run in order `001` through `011`. They are idempotent — safe to re-run.

### 2.3 Verify (optional)

```bash
psql medicine_tracker -f database/validate.sql
```

All 12 assertions should pass (the file rolls back any changes).

---

## Step 3 — Install dependencies

```bash
# Mobile (root)
npm install

# Backend
cd backend && npm install
```

### Android only — link native modules

React Native Firebase and react-native-iap require native linking. For Android this happens automatically via Gradle. Verify your `android/app/build.gradle` has:

```groovy
apply plugin: 'com.google.gms.google-services'  // at the bottom
```

And `android/build.gradle` has:

```groovy
classpath 'com.google.gms:google-services:4.4.0'  // in dependencies
```

---

## Step 4 — Run locally

### Backend

```bash
cd backend
npm run dev
# Server starts on http://localhost:3000
# GET http://localhost:3000/health → { status: "ok" }
```

### Mobile — Android

```bash
# Terminal 1: start Metro bundler
npm start

# Terminal 2: run on device/emulator
npm run android
```

### Mobile — iOS

```bash
# First time only — install CocoaPods
cd ios && pod install && cd ..

# Terminal 1
npm start

# Terminal 2
npm run ios
```

---

## Step 5 — iOS Info.plist setup

After `npx react-native run-ios` generates the Xcode project, open `ios/MedicineTracker/Info.plist` in Xcode and add these keys:

```xml
<key>NSUserNotificationsUsageDescription</key>
<string>MediTrack uses notifications to remind you to take your medicines on time.</string>

<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>remote-notification</string>
</array>
```

The full reference is in [ios/Info.plist.additions.xml](ios/Info.plist.additions.xml).

---

## Step 6 — Deploy backend to Railway

### 6.1 Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** → select this repo
3. Set root directory to `backend/`

### 6.2 Add PostgreSQL

1. In Railway project → **New** → **Database** → **PostgreSQL**
2. Railway auto-sets `DATABASE_URL` in the backend service environment

### 6.3 Set environment variables

In Railway → your backend service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `FIREBASE_PROJECT_ID` | from Firebase console |
| `FIREBASE_CLIENT_EMAIL` | from service account JSON |
| `FIREBASE_PRIVATE_KEY` | from service account JSON (with `\n`) |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | `*` (or your app's origin) |

All variables are documented in [backend/.env.example](backend/.env.example).

### 6.4 Get deploy token for CI/CD

1. Railway → **Account settings** → **Tokens** → generate
2. Add to GitHub repo → **Settings** → **Secrets** → `RAILWAY_TOKEN`

Pushes to `main` that touch `backend/` will now auto-deploy via [.github/workflows/deploy-backend.yml](.github/workflows/deploy-backend.yml).

### 6.5 Point the mobile app at Railway

In `src/api/client.ts`, `BASE_URL` reads from `process.env.API_BASE_URL`. Set this in your React Native build config (e.g. a `.env` file with [react-native-config](https://github.com/luggit/react-native-config)):

```
API_BASE_URL=https://your-service.up.railway.app
```

---

## Step 7 — In-App Purchases setup

### Android (Google Play)

1. Create app in [Google Play Console](https://play.google.com/console)
2. Go to **Monetize** → **Subscriptions** → create two products:
   - Product ID: `com.meditrack.premium.monthly` — Monthly
   - Product ID: `com.meditrack.premium.annual`  — Annual
3. For server-side receipt validation, create a **Google Play service account**:
   - Google Play Console → **Setup** → **API access** → link to Google Cloud project
   - Create service account with **Pub/Sub Editor** role
   - Download JSON key → set `PLAY_STORE_SERVICE_ACCOUNT_KEY` in Railway env

### iOS (App Store)

1. In [App Store Connect](https://appstoreconnect.apple.com) → your app → **Subscriptions**
2. Create subscription group `Premium`
3. Add two subscriptions with matching product IDs
4. In App Store Connect → **Users and Access** → **Integrations** → **In-App Purchase** → generate shared secret
5. Set `APP_STORE_SHARED_SECRET` in Railway env

---

## Step 8 — App Store submission checklist

### Both platforms
- [ ] App icon: 1024×1024 PNG (no alpha), placed in `android/app/src/main/res/mipmap-*/` and Xcode asset catalog
- [ ] Splash screen configured
- [ ] Privacy policy URL ready (required for apps with auth)
- [ ] App description + screenshots prepared

### Android
- [ ] `android/app/build.gradle` — set `versionCode` and `versionName`
- [ ] Sign release build: `cd android && ./gradlew bundleRelease`
- [ ] Upload `.aab` to Google Play Console → Internal testing first

### iOS
- [ ] Xcode → select team, set bundle ID `com.medicinetracker`
- [ ] Add `GoogleService-Info.plist` to Xcode project
- [ ] Product → Archive → Distribute App → App Store Connect
- [ ] Submit for TestFlight before production

---

## Environment variables reference

See [backend/.env.example](backend/.env.example) for the full list. Required for production:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `FIREBASE_PROJECT_ID` | ✅ | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | ✅ | Service account email |
| `FIREBASE_PRIVATE_KEY` | ✅ | Service account private key |
| `NODE_ENV` | ✅ | `production` |
| `ALLOWED_ORIGINS` | ✅ | CORS allowed origins |
| `USER_PLAN_TTL_MS` | — | Subscription cache TTL (default 600000) |
| `PLAY_STORE_SERVICE_ACCOUNT_KEY` | billing | Google Play service account JSON |
| `APP_STORE_SHARED_SECRET` | billing | Apple shared secret |

---

## Running tests

```bash
# Backend unit tests
cd backend && npm test

# Type check (both)
cd backend && npm run ts:check
npm run ts:check  # mobile root
```

---

## Troubleshooting

**`Firebase Admin SDK not configured`**  
→ Check that all three `FIREBASE_*` env vars are set and `FIREBASE_PRIVATE_KEY` has `\n` (not real newlines) in `.env`.

**`firebase_uid_map` table not found**  
→ Run `npm run migrate` to apply migration 011.

**Android build fails after adding Firebase**  
→ Ensure `google-services.json` is at `android/app/google-services.json` and `apply plugin: 'com.google.gms.google-services'` is at the bottom of `android/app/build.gradle`.

**IAP products not loading in simulator**  
→ Expected — StoreKit / Google Play Billing don't work in simulators. Test on a real device with a sandbox account.

**`SCHEDULE_EXACT_ALARM` permission denied on Android 12+**  
→ Go to device Settings → Apps → MediTrack → Alarms & reminders → Allow.
