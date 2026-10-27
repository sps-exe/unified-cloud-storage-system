# Google Cloud OAuth 2.0 Setup Guide

This guide walks you through setting up Google Drive API credentials so you—or any other user/developer—can connect multiple Google Drive accounts to UCSS.

---

## ⏱️ Quick Setup (Under 3 Minutes)

### Step 1: Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top left → **New Project**.
3. Name it `UCSS-Storage` (or any name) and click **Create**.

### Step 2: Enable the Google Drive API
1. In the search bar at the top, search for **"Google Drive API"**.
2. Click on **Google Drive API** and click the blue **Enable** button.

### Step 3: Configure the OAuth Consent Screen
1. In the left sidebar, navigate to **APIs & Services** → **OAuth consent screen**.
2. Choose **External** user type and click **Create**.
3. Fill in the required fields:
   * **App name:** `Unified Cloud Storage System`
   * **User support email:** Your email
   * **Developer contact email:** Your email
4. Click **Save and Continue**.
5. On the **Scopes** page:
   * Click **Add or Remove Scopes**.
   * Add: `https://www.googleapis.com/auth/drive.file` (Narrow, least-privilege scope).
   * Click **Save and Continue**.
6. On the **Test users** page:
   * **IMPORTANT FOR MULTI-USER ACCESS:**
     If your app is in "Testing" mode, Google will block any Google account that is not listed under **Test users**.
     Click **+ ADD USERS** and enter:
     - Your personal Google emails
     - Any friends, colleagues, or mentors testing the app
   * *(Optional: Once ready for general public use, click "Publish App" on the OAuth consent screen to allow ANY Google account to connect without being added as a test user).*
7. Click **Save and Continue**.

### Step 4: Create OAuth 2.0 Credentials
1. In the left sidebar, click **Credentials**.
2. Click **+ CREATE CREDENTIALS** at the top → select **OAuth client ID**.
3. Choose **Application type:** `Web application`.
4. Set **Name:** `UCSS Web Client`.
5. Under **Authorized redirect URIs**, click **+ ADD URI** and add:
   ```
   http://localhost:4000/api/oauth/google/callback
   ```
   *(If deploying to production, e.g. Vercel/Render, add your production domain: `https://your-domain.com/api/oauth/google/callback`)*.
6. Click **Create**.
7. Copy your **Client ID** and **Client Secret**.

---

## 🔐 Step 5: Update Your Environment (`.env`)

In your project root (or `apps/api/.env`), paste your credentials:

```ini
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/oauth/google/callback
```

Restart your server (`pnpm start`). You can now connect any number of Google Drive accounts seamlessly!
