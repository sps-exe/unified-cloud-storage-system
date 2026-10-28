# Google OAuth setup

UCSS links Drive accounts through *your own* Google Cloud OAuth client, so Google credentials never leave
your server. This is a one-time, ~5 minute job per UCSS installation (not per user).

## 1. Create the project and enable the API
1. Open the [Google Cloud Console](https://console.cloud.google.com/) → project picker → **New project** (any name).
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.

## 2. Configure the consent screen
1. **APIs & Services → OAuth consent screen** (or **Google Auth Platform** in the newer console).
2. User type **External**. Fill in app name, support email, developer email.
3. **Scopes**: add
   - `https://www.googleapis.com/auth/drive.file` — UCSS can only see files it created itself (least privilege)
   - `.../auth/userinfo.email` and `openid` — to show which Google account is linked
4. **Publish the app** (Audience → *In production*). This matters:

   | Mode | What happens |
   |------|--------------|
   | *Testing* | Only listed test users can connect, **and Google expires their refresh tokens after 7 days** — linked accounts will flip to `TOKEN_EXPIRED` weekly. |
   | *In production* | Tokens stay valid until revoked. These scopes are non-sensitive, so no Google verification review is required. |

## 3. Create the credentials
1. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URIs** — must match your server's public URL exactly:
   - Local: `http://localhost:4000/api/oauth/google/callback`
   - Hosted: `https://your-domain.com/api/oauth/google/callback`
3. Copy the **Client ID** and **Client secret**.

## 4. Tell UCSS
Put them in `.env` (next to `docker-compose.yml`) and restart:

```ini
APP_URL=http://localhost:4000            # the same host you registered above
GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
# GOOGLE_REDIRECT_URI is derived from APP_URL; set it only if you registered something different.
```

```bash
docker compose up -d --build     # or: pnpm start
```

Open the app → **Connect Google Drive Account**. Repeat for each Google account you want in the pool.

## Troubleshooting
- **`redirect_uri_mismatch`** — the URI in Google Cloud differs from `APP_URL` + `/api/oauth/google/callback` (scheme, port and trailing slash all count).
- **Account shows `TOKEN_EXPIRED`** — the consent was revoked or the app is still in *Testing*. Click **Reconnect**.
- **"No refresh token"** — remove UCSS at <https://myaccount.google.com/permissions> and connect again.
