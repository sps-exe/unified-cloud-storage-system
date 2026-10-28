# UCSS — Unified Cloud Storage System

**Pool the free storage of several Google Drive accounts into one drive.** Connect as many Google accounts as you like; UCSS shows them as a single searchable file manager, places each upload on the account with the most room, and can mount the whole pool as a network drive in Finder or Explorer.

Self-hosted: you run it, you own the data path. Your files live in *your* Google Drives (inside a `_UCSS_ROOT_` folder per account); UCSS stores only metadata and encrypted refresh tokens.

## What you get

- **One pool, many accounts** — upload once, UCSS picks the Drive with the most free space (or pin one). Files bigger than any single free slot still fit as long as one account has room.
- **Multi-user** — every person on your server has a private pool; nobody sees another user's files or accounts.
- **Browse, search, preview, stream** — filter by type or drive, sort, preview images/video/audio/PDF, seek in media (HTTP range requests).
- **Network drive (WebDAV)** — mount it in macOS Finder, Windows Explorer or `davfs2`.
- **Optional zero-knowledge vault** — encrypt a file in the browser (AES-256-GCM, PBKDF2) before it leaves your machine; the passphrase is never sent anywhere.
- **Self-healing accounting** — quota is reserved before upload and a background worker repairs stuck uploads and drift, so a crashed upload never leaks space.

## Quick start (Docker)

```bash
git clone <this repo> && cd ucss
node scripts/setup.mjs            # creates .env with fresh secrets
docker compose up -d --build      # Postgres + app, migrations run automatically
```

Open <http://localhost:4000>, create your account (the first one is always allowed), then follow the on-screen **one-time Google setup** (≈5 min, [guide](docs/google-oauth-setup.md)) and click **Connect Google Drive Account**.

> **Back up `TOKEN_ENCRYPTION_KEY`** from `.env`. It protects the stored Google tokens; if it is lost, every Drive account must be reconnected.

### Without Docker
Needs Node 20+, pnpm 9+, PostgreSQL 14+.

```bash
pnpm install
node scripts/setup.mjs            # then edit DATABASE_URL in .env to point at your Postgres
pnpm db:deploy                    # apply migrations
pnpm build && pnpm start          # API + web UI on http://localhost:4000
```
Developing the UI: `pnpm dev` (Vite on :5173 proxies to the API on :4000).

Existing database created earlier with `prisma db push`? Run `pnpm --filter @ucss/database exec prisma migrate resolve --applied 0_init` once, then `pnpm db:deploy`.

## Running it for other people

| Setting (`.env`) | Purpose |
|---|---|
| `APP_URL` | Public URL of your server. Used for the Google redirect and the WebDAV address. Put it behind HTTPS (Caddy/nginx/Cloudflare Tunnel). |
| `TRUST_PROXY=1` | Set when behind a reverse proxy so rate limits see real client IPs. |
| `ALLOW_REGISTRATION=false` | Close sign-ups after you (and your invitees) have accounts. |
| `MAX_UPLOAD_BYTES` | Largest single file (default 2 GiB). Uploads are spooled to disk, not RAM. |
| `RECONCILE_INTERVAL_MINUTES` | How often the background repair/quota-sync worker runs (default 10). |

Every user connects their *own* Google accounts through the single OAuth client you configured; nobody needs Google Cloud access themselves.

## Mounting as a drive

URL: `https://<your-host>/webdav` — sign in with your UCSS email and password.

- **macOS**: Finder → ⌘K → paste URL.
- **Windows**: This PC → *Map network drive* → *Connect using different credentials*. (Windows requires HTTPS for Basic auth unless a registry tweak is applied.)
- **Linux**: `sudo mount -t davfs https://<your-host>/webdav /mnt/ucss`

The drive is flat (no sub-folders). Saving a file with an existing name replaces it.

## Good to know

- **Deleting is permanent**: it removes the file from the Google Drive that holds it, which frees the space immediately. Database rows are kept as soft-deleted audit records.
- Files are stored flat inside `_UCSS_ROOT_` in each Drive; don't rename or delete that folder by hand.
- UCSS uses the narrow `drive.file` scope: it can only touch files it created, never the rest of your Drive.
- Large uploads use Google's multipart upload; for multi-GB files on flaky links, prefer a smaller `MAX_UPLOAD_BYTES` until resumable uploads land.
- Preview of zero-knowledge files requires the passphrase; UCSS cannot recover it.

## Architecture

```
React SPA ─┐
Finder/Explorer (WebDAV) ─┼─► Express API ─► PostgreSQL (accounts, files, reservations, audit)
HTTP range streaming ─┘          └────────► Google Drive API v3 (one OAuth token per linked account)
```

- `apps/api` — Express + raw SQL (Prisma client for connections). Allocation uses row locks plus `pg_advisory_xact_lock`; reconciliation uses `FOR UPDATE SKIP LOCKED`.
- `apps/web` — React + Vite + Tailwind.
- `packages/database` — Prisma schema and migrations (`prisma/migrations`).
- `packages/shared` — DTOs shared by both sides.

## Development

```bash
# tests need a throwaway database, never your real one
createdb ucss_test && psql ucss_test -f packages/database/prisma/migrations/0_init/migration.sql
DATABASE_URL=postgresql://…/ucss_test pnpm --filter @ucss/api test
```

See [SECURITY.md](SECURITY.md) to report vulnerabilities and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License
MIT © Shaurya Pratap Singh
