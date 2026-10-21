# Unified Cloud Storage System (UCSS)

> **Enterprise-grade distributed cloud storage aggregator that pools ~10 Google Drive accounts into a unified, high-performance virtual filesystem using Node.js, Express, PostgreSQL 16, and React.**

[![CI/CD Pipeline](https://github.com/shaurya-sps/unified-cloud-storage-system/actions/workflows/ci.yml/badge.svg)](https://github.com/shaurya-sps/unified-cloud-storage-system/actions)
[![Tests Passing](https://img.shields.io/badge/tests-117%20passing%20%7C%20100%25-10b981?style=flat-square&logo=checkmarx)](scripts/run-all-tests.py)
[![Database](https://img.shields.io/badge/database-PostgreSQL%2016%20Raw%20SQL-336791?style=flat-square&logo=postgresql)](packages/database/src/queries)
[![Security](https://img.shields.io/badge/security-AES--256--GCM%20Encrypted%20Tokens-8b5cf6?style=flat-square&logo=openaccess)](apps/api/src/lib/crypto.ts)
[![TypeScript](https://img.shields.io/badge/typescript-strict%20v5.7-3178c6?style=flat-square&logo=typescript)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

---

## 💡 Executive Summary & The Problem Solved

Every personal Google account receives 15 GB of free cloud storage. Users commonly maintain multiple accounts across personal, freelance, academic, and side projects. However, these accounts become **fragmented data silos**:
* **Zero Cross-Account Search:** You must remember which account holds which file.
* **Artificial Capacity Walls:** A 4 GB video cannot utilize the 2 GB remaining on Account A and 3 GB on Account B.
* **Management Overhead:** Constantly switching browser profiles and authentications.

**UCSS transforms these fragmented accounts into a singular, high-capacity virtual filesystem.** 

Google Drive serves strictly as the underlying distributed binary storage fabric (isolated to a dedicated `_UCSS_ROOT_` directory), while a centralized **PostgreSQL 16 database** serves as the transactional brain—orchestrating atomic byte reservations, row-level concurrency locks, high-speed cached directory browsing, and self-healing reconciliation.

```
       ┌─────────────────────────────────────────────────────────────┐
       │                Unified Cloud Storage System                 │
       │           Single Dashboard • Unified Quota Meter            │
       └──────────────┬───────────────────────────────┬──────────────┘
                      │                               │
         Metadata & Atomic Locks             Binary Streaming & Storage
                      ▼                               ▼
       ┌─────────────────────────────┐  ┌─────────────────────────────┐
       │     PostgreSQL 16 Engine    │  │   Google Drive Cloud Fabric │
       │  • Raw SQL byte reservation │  │  • Account #1 (15 GB)       │
       │  • Advisory transaction locks│ │  • Account #2 (15 GB)       │
       │  • AES-256-GCM token vault  │  │  • Account #3 (15 GB)       │
       │  • Single-pass window query │  │  • Account #N (~150 GB+)    │
       └─────────────────────────────┘  └─────────────────────────────┘
```

---

## 🏛️ System Architecture

### Modular Monolith Architecture
```mermaid
flowchart TD
    subgraph Client["Presentation Layer (React 18 SPA)"]
        UI["Web Dashboard & File Explorer"]
        Meter["Unified Storage Meter & Analytics"]
        UploadModal["Upload Modal (Target Account Selector)"]
    end

    subgraph API["Application Services (Node.js Express Modular Monolith)"]
        AuthMw["Authentication & Session Middleware"]
        AllocSvc["Allocation Engine (Water-Level Balancing)"]
        FileSvc["Streaming Files & Proxy Service"]
        OAuthSvc["Google OAuth 2.0 Engine"]
        ReconCron["Background Reconciler Worker"]
    end

    subgraph Data["Persistence Layer (PostgreSQL 16 Engine)"]
        Advisory["pg_advisory_xact_lock (Account Serialization)"]
        DriveAcc["drive_accounts (Encrypted Tokens & Quota)"]
        FilesTab["files (Soft-Delete Metadata Index)"]
        UploadOps["upload_operations (State Machine Auditing)"]
    end

    subgraph Cloud["Storage Fabric (Google Drive API v3)"]
        GD1["Google Account #1 (_UCSS_ROOT_)"]
        GD2["Google Account #2 (_UCSS_ROOT_)"]
        GD3["Google Account #N (Institutional / Personal)"]
    end

    UI -->|REST + HttpOnly JWT| AuthMw
    AuthMw --> AllocSvc
    AuthMw --> FileSvc
    AuthMw --> OAuthSvc
    
    AllocSvc -->|SELECT ... FOR UPDATE| Advisory
    AllocSvc -->|Atomic Byte Increment| DriveAcc
    FileSvc -->|Streaming Multipart Pipe| Cloud
    ReconCron -->|FOR UPDATE SKIP LOCKED| FilesTab
    OAuthSvc -->|AES-256-GCM Encrypted Token| DriveAcc
```

---

## ⚡ Concurrency & Two-Phase Reservation Protocol

To guarantee that parallel uploads never cause quota overflows or database inconsistencies, UCSS implements a deterministic **Two-Phase Distributed Reservation Protocol**:

```
Client               UCSS API Server             PostgreSQL 16            Target Google Drive
  │                        │                            │                          │
  │─── 1. POST /allocate ─>│                            │                          │
  │                        │─── 2. Begin Transaction ──>│                          │
  │                        │    • Advisory Lock (Hash)  │                          │
  │                        │    • Verify Headroom >= S  │                          │
  │                        │    • reserved_bytes += S   │                          │
  │                        │    • Insert File (PENDING) │                          │
  │                        │<── 3. Commit Reservation ──│                          │
  │<── 4. File ID & Ack ───│                            │                          │
  │                        │                            │                          │
  │─── 5. POST /upload ───>│                            │                          │
  │    (Binary Stream)     │─── 6. Pipe Stream ───────────────────────────────────>│
  │                        │                                                       │
  │                        │<── 7. Upload Complete (Drive File ID) ────────────────│
  │                        │                            │                          │
  │                        │─── 8. Atomic Finalize ────>│                          │
  │                        │    • quota_used_bytes += S │                          │
  │                        │    • reserved_bytes -= S   │                          │
  │                        │    • File status = ACTIVE  │                          │
  │                        │<── 9. Finalized ───────────│                          │
  │<── 10. Success (200) ──│                            │                          │
```

---

## 🔄 The Distributed Commit Problem & Reconciliation State Machine

### The Fundamental Challenge
Google Drive API v3 does **not** participate in distributed two-phase commit (2PC) or XA transactions. If a network partition, client crash, or timeout occurs after bytes are reserved in PostgreSQL but before Google Drive completes the upload:
- **Naive Implementation Flaw:** Held byte reservations are leaked forever, causing false "Storage Quota Exceeded" errors.
- **Premature Commit Flaw:** Committing before Google Drive confirmation produces "phantom files" that exist in the database but have zero remote binary chunks.

### The Self-Healing State Machine
UCSS models upload operations as an explicit, crash-recoverable state machine:

```mermaid
stateDiagram-v2
    [*] --> PENDING: 1. /api/files/allocate (advisory lock + byte reservation)
    PENDING --> UPLOADING: 2. Stream initiated to Google Drive API v3
    UPLOADING --> ACTIVE: 3. Drive ID received (reserved -> used bytes)
    UPLOADING --> FAILED: Network error / client disconnect
    PENDING --> FAILED: Timeout (> 30 min with no stream)
    ACTIVE --> DELETED: Soft-delete (preserve audit & metadata)
    FAILED --> [*]: Orphaned reservation released
    DELETED --> [*]
```

### Self-Healing Background Reconciler
The automated background reconciliation worker guarantees eventual consistency without human intervention:
1. **Contention-Free Queue Claiming:** Queries stuck operations (`upload_status = 'UPLOADING' AND updated_at < NOW() - INTERVAL '30 minutes'`) using `SELECT ... FOR UPDATE OF files SKIP LOCKED`.
2. **Remote Google Drive Truth Verification:** Queries Google Drive API v3 by file ID or multipart boundary to determine whether the remote file actually completed.
3. **Deterministic Compensation:**
   - If Google Drive created the file: Updates database status to `ACTIVE`, links the `google_drive_file_id`, and shifts reserved bytes into used bytes.
   - If Google Drive never received the file: Rolls back `reserved_bytes`, transitions file status to `FAILED`, and records an immutable audit log entry (`UPLOAD_ABORTED_STUCK`).
4. **Drift Detection:** Compares the sum of active file sizes with Google's reported `quotaBytesUsed` and recalibrates if external changes occurred.

---

## 🔬 Database & SQL Engineering Deep Dive

While Prisma is utilized for schema migrations, **all mission-critical operations are written in handcrafted Raw SQL** to unlock PostgreSQL 16 advanced primitives:

### 1. Row-Level Locks & Advisory Locks (`pg_advisory_xact_lock`)
```sql
-- Serializes allocations on a specific account without locking unrelated accounts
SELECT pg_advisory_xact_lock(hashtext('alloc_' || da.id::text))
FROM drive_accounts da
WHERE da.id = $1::uuid;
```
Advisory locks are automatically released when the database transaction commits or rolls back, providing sub-millisecond serialization without table-level locking bottlenecks.

### 2. High-Throughput Worker Queuing (`FOR UPDATE SKIP LOCKED`)
```sql
-- Reconciliation workers claim stuck uploads without lock contention
SELECT f.id, f.drive_account_id, f.size_bytes
FROM files f
WHERE f.upload_status = 'UPLOADING'
  AND f.updated_at < NOW() - INTERVAL '30 minutes'
FOR UPDATE OF f SKIP LOCKED
LIMIT 50;
```
Multiple background worker instances can run in parallel; each automatically claims distinct records without blocking each other or encountering deadlocks.

### 3. Single-Pass Window Function Pagination
```sql
-- Retrieves metadata, total matching count, and dynamic sorting in a single round-trip
SELECT 
  f.id, f.display_filename, f.size_bytes, f.mime_type, f.created_at,
  da.google_email AS "driveAccountEmail",
  COUNT(*) OVER () AS total_count
FROM files f
JOIN drive_accounts da ON da.id = f.drive_account_id
WHERE f.user_id = $1::uuid AND f.is_deleted = FALSE
ORDER BY 
  CASE WHEN $2 = 'name' AND $3 = 'asc' THEN f.display_filename END ASC,
  CASE WHEN $2 = 'name' AND $3 = 'desc' THEN f.display_filename END DESC,
  f.created_at DESC
LIMIT $4 OFFSET $5;
```

### 4. Integrity Constraints Enforcing Physical Laws
```sql
-- Prevents negative quota or inverted reservations at the database kernel level
ALTER TABLE drive_accounts 
  ADD CONSTRAINT chk_quota_non_negative CHECK (quota_limit_bytes >= 0),
  ADD CONSTRAINT chk_quota_used_valid CHECK (quota_used_bytes >= 0),
  ADD CONSTRAINT chk_reserved_valid CHECK (reserved_bytes >= 0);
```

### 5. Non-Destructive Soft Deletes
```sql
-- Deletes preserve audit trails and integrity forever:
UPDATE files 
SET is_deleted = TRUE, deleted_at = NOW(), upload_status = 'DELETED'
WHERE id = $1::uuid AND user_id = $2::uuid;
```
Every query filters on `is_deleted = FALSE`, supported by high-speed partial composite indexing:
```sql
CREATE INDEX idx_files_user_active ON files (user_id, created_at DESC) WHERE is_deleted = FALSE;
```

---

## ⚖️ Technology Stack Justifications & Tradeoffs

| Technology | Selection Rationale | Alternatives Evaluated & Tradeoffs |
| :--- | :--- | :--- |
| **Node.js (v20+)** | **Non-blocking asynchronous stream piping.** Node's native stream pipes allow streaming gigabytes of binary data from browser clients directly into Google Drive API v3 without buffering entire files in heap RAM, maintaining a constant sub-100MB server footprint. | *Go / Rust:* Higher raw execution speed, but the official Google Drive API v3 SDK and token lifecycle tooling in TypeScript/Node are exceptionally mature and reliable for OAuth. |
| **Strict TypeScript 5.7+** | **End-to-End Type Safety.** Monorepo architecture shares strict DTOs, API envelopes, and validation schemas across backend services, raw SQL query results, and the React frontend—eliminating runtime serialization mismatches. | *Pure JavaScript:* Too error-prone when orchestrating complex distributed state machines, quota arithmetic, and cryptographic byte buffers. |
| **PostgreSQL 16** | **ACID Engine & Concurrency Primitives.** Unlocks sub-millisecond serialization via `pg_advisory_xact_lock`, contention-free background worker claiming via `FOR UPDATE SKIP LOCKED`, single-pass window pagination (`COUNT(*) OVER ()`), and strict physical CHECK constraints. | *MongoDB / DynamoDB:* Lack atomic cross-document isolation without heavy distributed transactions; cannot guarantee deterministic byte quotas under high concurrency. |
| **Prisma + Hand-Tuned Raw SQL** | **Hybrid Data Layer.** Prisma is utilized exclusively for declarative schema migrations and basic CRUD scaffolding, while all high-concurrency operations (allocations, reservations, reconciliation, pagination) are implemented in handcrafted Raw SQL. | *Pure ORM:* Suboptimal N+1 query patterns, inability to invoke PostgreSQL advisory transaction locks, and inability to execute skip-locked worker queues. |
| **React 18 + Vite + Tailwind** | **High-Density Data Presentation.** Rapid 60 FPS client rendering with custom multi-color capacity gauges, real-time debounced search, and zero bloat. | *Next.js SSR:* Unnecessary server-rendering overhead for a desktop-class authenticated file manager; Vite delivers instant client HMR and static CDN asset caching. |

---

## 🔒 Security & Token Hygiene

* **AES-256-GCM Token Encryption:** Refresh tokens are never stored in plaintext. Every token is encrypted with an authenticated 12-byte initialization vector and 16-byte authentication tag:
  $$\text{Payload} = \text{IV (12B)} \,\|\, \text{AuthTag (16B)} \,\|\, \text{Ciphertext}$$
* **Least-Privilege Scope:** Restricted strictly to `https://www.googleapis.com/auth/drive.file`. The app can only see files it created; it cannot inspect user emails, contacts, or preexisting Drive documents.
* **Cryptographic Anti-CSRF:** The OAuth flow encrypts a signed payload (userId + timestamp + HMAC) inside the Google `state` parameter to defeat authorization code interception.
* **Strict Session Isolation:** Refresh cookies use `HttpOnly; SameSite=Lax; Path=/` with dual localStorage fallback for privacy browsers (Brave Shields).

---

## 🧪 Verification & Test Suite

The repository includes a comprehensive automated test runner with **117 integration test assertions** across 5 suites:

```
================================================================================
🚀 UNIFIED CLOUD STORAGE SYSTEM (UCSS) — MASTER TEST SUITE
================================================================================
[1/5] Phase 2: Authentication & Quota Aggregation ........... ✅ 29/29 PASSED (100%)
[2/5] Phase 3: Multi-Account Manager & AES-256 Tokens ....... ✅ 34/34 PASSED (100%)
[3/5] Phase 4 & 5: Storage Allocation Engine & Files ........ ✅ 23/23 PASSED (100%)
[4/5] Phase 6: Reliability & Background Reconciliation ...... ✅ 20/20 PASSED (100%)
[5/5] Phase 7: Frontend Web Application & Assets ............ ✅ 11/11 PASSED (100%)
================================================================================
🏆 MASTER SCORECARD: 117 / 117 Assertions Passing (100%)
================================================================================
```

Run all tests locally:
```bash
python3 scripts/run-all-tests.py
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** >= 20.x
- **pnpm** >= 9.x
- **PostgreSQL** 16 (or Docker)
- **Python** 3.10+

### 2. Environment Setup
```bash
# Clone the repository
git clone https://github.com/shaurya-sps/unified-cloud-storage-system.git
cd unified-cloud-storage-system

# Install dependencies across all packages
pnpm install

# Copy configuration template
cp .env.example .env
```

Generate your cryptographic secrets:
```bash
# Generate JWT Secrets (run twice for access and refresh)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate 32-byte AES-256-GCM Token Encryption Key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste the outputs into `.env`:
```ini
JWT_ACCESS_SECRET=your_generated_access_secret
JWT_REFRESH_SECRET=your_generated_refresh_secret
TOKEN_ENCRYPTION_KEY=your_generated_64_char_hex_key
```

### 3. Google OAuth Setup
1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Set **Authorized redirect URIs** to:
   ```
   http://localhost:4000/api/oauth/google/callback
   ```
4. Copy Client ID and Client Secret into `.env`:
   ```ini
   GOOGLE_CLIENT_ID=your_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-your_secret
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/oauth/google/callback
   ```

### 4. Database Initialization & Start
```bash
# Start PostgreSQL via Docker Compose (if not using local Postgres)
docker-compose up -d postgres

# Run database migrations
pnpm --filter @ucss/database prisma migrate deploy

# Start the unified daemon
python3 scripts/dev-server.py start
```

Open [http://localhost:4000](http://localhost:4000) in your browser. Register your account and link your Google accounts into the pool!

---

## 🚢 Production Deployment Architecture

UCSS supports two production deployment architectures:
1. **Decoupled Architecture (Recommended):** Frontend on **Vercel** edge CDN, with the Node.js streaming backend on **Render**, **Railway**, or **AWS ECS/Fly.io**.
2. **Unified Monolith Architecture:** Backend and frontend bundled together into a single multi-stage Docker container (`Dockerfile`) serving static assets from `/public`.

### 1. Frontend Deployment on Vercel
The frontend is pre-configured with [`apps/web/vercel.json`](apps/web/vercel.json) and root [`vercel.json`](vercel.json), providing automated single-page application fallback routing, immutability caching for hashed static assets (`max-age=31536000`), and security headers.

Deploy via the Vercel CLI:
```bash
# From workspace root
vercel --prod
```
Or import your GitHub repository into the Vercel dashboard:
- **Framework Preset:** Vite
- **Root Directory:** `apps/web` (or root with monorepo build)
- **Build Command:** `pnpm build`
- **Output Directory:** `dist`

### 2. Backend Deployment (Render / Railway / Docker)
Because the Express backend manages long-lived database connections, AES-256-GCM encryption streams, and periodic reconciliation workers, it runs as a persistent containerized service.

#### Option A: Render Blueprint (`render.yaml`)
A turnkey [`render.yaml`](render.yaml) is included. Simply link your GitHub repository to Render:
- Provisions a managed **PostgreSQL 16** database with automatic connection string injection.
- Provisions a Docker web service with automatic health checks against `/api/health`.

#### Option B: Railway (`railway.json`)
Deploy with the included [`railway.json`](railway.json) and root [`Dockerfile`](Dockerfile).

#### Option C: Production Docker Build
```bash
docker build -t ucss-monolith:latest -f Dockerfile .
docker run -p 4000:4000 --env-file .env ucss-monolith:latest
```

### 3. Production Environment Variable Matrix

| Variable | Frontend (Vercel) | Backend (Render / Railway / Docker) | Description |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | — | `production` | Enables production optimizations & Helmet security |
| `PORT` | — | `4000` | Server listening port |
| `DATABASE_URL` | — | `postgresql://user:pass@host:5432/db?sslmode=require` | PostgreSQL 16 pooled connection string |
| `VITE_API_URL` | `https://your-api.onrender.com` | — | Target API origin (omit if reverse-proxied) |
| `CORS_ORIGIN` | — | `https://your-app.vercel.app` | Allowed CORS origin for credentials |
| `JWT_ACCESS_SECRET` | — | `64-byte hex string` | Signs 15-minute access JWTs |
| `JWT_REFRESH_SECRET` | — | `64-byte hex string` | Signs 7-day refresh JWTs |
| `TOKEN_ENCRYPTION_KEY` | — | `32-byte (64 hex char) string` | Authenticated AES-256-GCM master key |
| `GOOGLE_CLIENT_ID` | — | `*.apps.googleusercontent.com` | Google Cloud OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | — | `GOCSPX-*` | Google Cloud OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | — | `https://your-api.onrender.com/api/oauth/google/callback` | Authorized Google OAuth callback URL |

---

## 🎙️ Mentor Showcase & Technical Interview Guide

Looking for a concise script to demonstrate UCSS to a technical lead, mentor, or hiring manager?  
👉 Read the step-by-step [**3-Minute Technical Mentor Demonstration Script**](docs/mentor-showcase-script.md), covering:
- The Elevator Pitch & Distributed Commit problem formulation (0:00 - 0:30)
- Live UI Walkthrough with 9 connected accounts and multi-color storage meter (0:30 - 1:15)
- Under the hood of the Two-Phase Byte Reservation Protocol with row locks (1:15 - 2:00)
- Fault tolerance, soft deletes, and self-healing reconciliation with `SKIP LOCKED` (2:00 - 2:40)
- Architectural tradeoff justifications and anticipated Q&A (2:40 - 3:00)

---

## 📁 Monorepo Layout

```
├── apps/
│   ├── api/                     # Express modular monolith API server
│   │   ├── src/routes/          # REST endpoints (auth, accounts, files, oauth, admin)
│   │   ├── src/services/        # Business logic (allocation, files, accounts, drive, recon)
│   │   └── src/middleware/      # JWT auth, Zod validation, error handling, rate limiting
│   └── web/                     # React 18 SPA (Vite + Tailwind CSS)
│       ├── src/components/      # StorageOverview, FileManager, UploadModal, AccountsModal
│       └── src/lib/api.ts       # Typed API client with auto-refresh & token persistence
├── packages/
│   ├── database/                # PostgreSQL schema, migrations, raw SQL query modules
│   └── shared/                  # Shared TypeScript DTOs, interfaces, API envelopes
├── scripts/
│   ├── dev-server.py            # Process daemon & production runner
│   └── run-all-tests.py         # Master integration test runner (117 assertions)
└── docs/                        # Architectural documentation & phase handoffs
```

---

## 📄 License & Governance

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.  
For security disclosures, please review [`SECURITY.md`](SECURITY.md).  
Guidelines for contributing can be found in [`CONTRIBUTING.md`](CONTRIBUTING.md).
