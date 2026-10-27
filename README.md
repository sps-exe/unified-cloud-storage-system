# Unified Cloud Storage System (UCSS)

> **High-throughput virtual filesystem aggregator pooling multiple distributed Google Drive accounts into a unified, atomic POSIX-compatible storage layer.**

[![CI/CD Pipeline](https://github.com/shaurya-sps/unified-cloud-storage-system/actions/workflows/ci.yml/badge.svg)](https://github.com/shaurya-sps/unified-cloud-storage-system/actions)
[![Integration Tests](https://img.shields.io/badge/tests-138%20passed%20%7C%20100%25-10b981?style=flat-square&logo=checkmarx)](scripts/run-all-tests.py)
[![Database](https://img.shields.io/badge/database-PostgreSQL%2016%20Raw%20SQL-336791?style=flat-square&logo=postgresql)](packages/database/src/queries)
[![Security](https://img.shields.io/badge/security-AES--256--GCM%20Authenticated-8b5cf6?style=flat-square&logo=openaccess)](apps/api/src/lib/crypto.ts)
[![TypeScript](https://img.shields.io/badge/typescript-strict%20v5.7-3178c6?style=flat-square&logo=typescript)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[Live Dashboard Demo](http://localhost:4000) • [System Architecture](#system-architecture) • [Engineering Highlights](#technical-highlights-database--concurrency-rigor) • [Quickstart](#zero-friction-quickstart)

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph Clients["Presentation & Protocol Layer"]
        Web["React 18 SPA (Linear Theme + Toast + Skeletons)"]
        WebDAV["WebDAV RFC 4918 (macOS Finder / Cyberduck)"]
    end

    subgraph API["UCSS Core Service (Node.js Express Modular Monolith)"]
        Auth["JWT Session & Token Guard"]
        Alloc["Allocation Engine (Water-Level Balancing)"]
        StreamPipe["Pass-Through Stream Pipe (Sub-100MB RAM)"]
        ReconCron["Background Reconciler (Eventual Consistency)"]
    end

    subgraph DB["Transactional State Machine (PostgreSQL 16 Raw SQL)"]
        Advisory["pg_advisory_xact_lock (Account Serialization)"]
        SkipLock["Worker Queue (FOR UPDATE SKIP LOCKED)"]
        WindowQ["Single-Pass Pagination (COUNT(*) OVER ())"]
        PartialIdx["Soft-Delete Partial Index (WHERE is_deleted = false)"]
    end

    subgraph Cloud["Distributed Binary Fabric (Google Drive API v3)"]
        D1["Account #1 (15 GB)"]
        D2["Account #2 (15 GB)"]
        DN["Account #N (Pooled ~150 GB+)"]
    end

    Web -->|REST / Multipart Stream| Auth
    WebDAV -->|PROPFIND / GET / PUT| StreamPipe
    Auth --> Alloc
    Alloc -->|Serialize & Reserve Bytes| Advisory
    Alloc -->|Atomic Balance Verification| DB
    StreamPipe -->|Piped Binary Chunks| Cloud
    ReconCron -->|Claim Stuck Leases| SkipLock
    Web -->|Metadata Query| WindowQ
    WindowQ --> PartialIdx
```

---

## 🔬 Technical Highlights: Database & Concurrency Rigor

* **Atomic Two-Phase Byte Reservations (`pg_advisory_xact_lock`):** Prevents quota over-allocation across concurrent upload threads by locking on hash representations of target account IDs. Guarantees deterministic headroom validation without holding disruptive table-level locks.
* **Self-Healing Distributed Commit Reconciliation (`SKIP LOCKED`):** Solves cloud API non-atomicity. Background workers claim orphaned or interrupted uploads older than 30 minutes using `SELECT ... FOR UPDATE OF files SKIP LOCKED`, verifying remote Drive status and recovering held bytes without human intervention.
* **Single-Pass Window Function Pagination (`COUNT(*) OVER ()`):** Eliminates redundant `SELECT COUNT(*)` round-trips. Metadata, cross-account ownership links, and filtered totals are evaluated in one database trip under dynamic sort constraints.
* **High-Speed Soft-Delete Indexing:** Deletion events preserve complete audit logs while maintaining microsecond search performance using partial indexing:
  ```sql
  CREATE INDEX idx_files_user_active ON files (user_id, created_at DESC) WHERE is_deleted = FALSE;
  ```
* **Zero-Knowledge Token Cryptography (AES-256-GCM):** Cloud OAuth refresh tokens are encrypted at rest with an authenticated 12-byte initialization vector and 16-byte authentication tag (`IV || AuthTag || Ciphertext`). Sensitive keys never hit plain storage.
* **Kernel-Enforced Storage Invariants:** Database-level CHECK constraints physically block race condition anomalies:
  ```sql
  ALTER TABLE drive_accounts 
    ADD CONSTRAINT chk_quota_non_negative CHECK (quota_limit_bytes >= 0),
    ADD CONSTRAINT chk_quota_used_valid CHECK (quota_used_bytes >= 0),
    ADD CONSTRAINT chk_reserved_valid CHECK (reserved_bytes >= 0);
  ```

---

## ⚡ Zero-Friction Quickstart

```bash
# 1. Clone & install dependencies
git clone https://github.com/shaurya-sps/unified-cloud-storage-system.git && cd unified-cloud-storage-system
pnpm install

# 2. Configure environment & apply migrations
cp .env.example .env
pnpm db:migrate

# 3. Start production services (API + Web on http://localhost:4000)
pnpm build && pnpm start
```

---

## 🧪 Automated Verification Suite

Run all 138 automated unit, database, and end-to-end integration assertions:

```bash
python3 scripts/run-all-tests.py
```

```
================================================================================
🚀 UNIFIED CLOUD STORAGE SYSTEM (UCSS) — MASTER TEST SUITE
================================================================================
[1/6] Phase 2: Authentication & Quota Aggregation ........... ✅ 29/29 PASSED (100%)
[2/6] Phase 3: Multi-Account Manager & AES-256 Tokens ....... ✅ 34/34 PASSED (100%)
[3/6] Phase 4 & 5: Storage Allocation Engine & Files ........ ✅ 23/23 PASSED (100%)
[4/6] Phase 6: Reliability & Background Reconciliation ...... ✅ 20/20 PASSED (100%)
[5/6] Phase 7: Frontend Web Application & Assets ............ ✅ 11/11 PASSED (100%)
[6/6] Phase 8: WebDAV RFC 4918 & Streaming Engine ........... ✅ 21/21 PASSED (100%)
================================================================================
🏆 MASTER SCORECARD: 138 / 138 Assertions Passing (100%)
================================================================================
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).
