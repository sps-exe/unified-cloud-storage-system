# 🎙️ 3-Minute Technical Mentor Demonstration Script

**Project:** Unified Cloud Storage System (UCSS)  
**Target Audience:** Technical Mentors, Senior Architects, Hiring Managers  
**Duration:** ~3 Minutes  
**Live UI:** [http://localhost:4000](http://localhost:4000) (or your Vercel deployment URL)

---

## ⏱️ Minute 0:00 – 0:30 | The Hook & The Hard Problem

> *"Hi everyone. Today I'm demonstrating the **Unified Cloud Storage System (UCSS)**—a distributed cloud storage engine that aggregates multiple free Google Drive accounts into a unified, high-performance virtual filesystem.*
>
> *Most people have 5 to 10 personal and school Google accounts, each with 15 GB of storage. That's over 100 GB of free storage, but it sits in fragmented silos: you can't search across them, and you can't upload a large file if no single account has enough headroom.*
>
> *The real challenge of this project wasn't just connecting to the Google Drive API. It was solving the **Distributed Commit Problem**: Google Drive does not support two-phase commit transactions with an external database. If a network drops mid-upload, how do you prevent quota drift, orphaned reservations, or double-counted storage? We solved this by using **PostgreSQL 16 as a transactional state coordinator**."*

---

## ⏱️ Minute 0:30 – 1:15 | The Live System & UI Architecture

*(Navigate to the live dashboard on screen)*

> *"Here is the live dashboard. Looking at the top header and storage gauge:*
>
> *1. **The Aggregated Meter:** You can see our connected personal Google accounts pooled into a singular storage fabric (~135 GB+).*
> *2. **The 3-Color Storage Distribution:** In purple is actual used storage; in emerald is available headroom; and in amber is our active in-flight reserved storage.*
> *3. **Google Drive Accounts Fabric:** Clicking **'Drive Accounts'**, you can see each individual node in the storage cluster with its live quota, headroom, and connection health.*
>
> *Notice our security architecture: Refresh tokens are encrypted with **AES-256-GCM** with authenticated 16-byte tags before ever touching the database, and we strictly enforce Google's least-privilege `drive.file` scope—meaning the app can never inspect any pre-existing personal documents."*

---

## ⏱️ Minute 1:15 – 2:00 | Concurrency & The Two-Phase Reservation Protocol

*(Open the Upload Modal)*

> *"Now let's look at how uploads are handled without race conditions.*
>
> *When I choose a file to upload, I can let UCSS automatically balance storage across the node with the highest headroom, or target a specific drive account.*
>
> *Under the hood, we execute a deterministic **Two-Phase Reservation Protocol**:*
> *1. **Phase 1: Byte Reservation.** The client calls `/api/files/allocate`. The backend opens a PostgreSQL transaction and acquires an advisory transaction lock: `pg_advisory_xact_lock(hashtext('alloc_' || account_id))`. This serializes allocations on that specific node without locking other accounts.*
> *2. It verifies that `used + reserved + file_size <= limit`, atomically increments `reserved_bytes`, and inserts a file record in state `PENDING`.*
> *3. **Streaming Transfer:** The browser then pipes the file stream directly through Node.js to Google Drive v3 without buffering the file in memory.*
> *4. **Phase 2: Atomic Finalize.** Once Google Drive responds with the remote file ID, a second atomic transaction decrements `reserved_bytes`, increments `quota_used_bytes`, transitions file status to `ACTIVE`, and records an immutable audit log.*
>
> *Even if 50 concurrent uploads hit the server simultaneously, database check constraints and row locks prevent quota over-commit."*

---

## ⏱️ Minute 2:00 – 2:40 | Resilience, Soft-Deletes & Background Reconciliation

*(Open the Diagnostics Modal)*

> *"Now, what happens when things go wrong? Network timeouts, closed browser tabs, or Google API throttling?*
>
> *Clicking **'Diagnostics'**, you can see our real-time state machine distribution: completed files, active uploads, failed operations, and soft-deleted records.*
>
> *To guarantee self-healing reliability, UCSS runs an automated **Background Reconciliation Worker**:*
> * *It queries stuck uploads aged over 30 minutes using raw SQL: `SELECT ... FOR UPDATE OF files SKIP LOCKED`. This allows multiple worker instances to run concurrently without deadlocks or duplicate work.*
> * *It inspects Google Drive via API v3 to see if the file actually landed.*
> * *If orphaned, it safely rolls back the held `reserved_bytes` on the account, marks the operation as `FAILED`, and logs the remediation.*
>
> *Furthermore, all file deletions are **non-destructive soft deletes** (`is_deleted = TRUE`). The database preserves full provenance, checksums, and audit logs while queries stay blazing fast via partial indexes: `WHERE is_deleted = FALSE`."*

---

## ⏱️ Minute 2:40 – 3:00 | Engineering Takeaways & Tech Stack Rationale

> *"To summarize the technical decisions:*
> * *We chose **PostgreSQL 16 with Raw SQL** because mission-critical concurrency primitives like advisory locks, check constraints, and window pagination (`COUNT(*) OVER()`) cannot be reliably expressed through high-level ORMs.*
> * *We chose **Node.js with Express** for non-blocking backpressure streams between browser clients and Google APIs.*
> * *We used strict **TypeScript** across shared monorepo packages to maintain end-to-end type safety from database schemas to React components.*
> * *And the entire system is verified by an automated test suite containing **117 integration assertions running at 100% pass rate**.*
>
> *Thank you! I'm happy to dive deeper into any of the SQL transactions, crypto implementation, or state machine architecture."*

---

## 🎯 Anticipated Mentor Questions & 10-Second Answers

| Question | Concise Technical Answer |
| :--- | :--- |
| **Why not use Redis for distributed locks?** | PostgreSQL was already our source of truth. Using `pg_advisory_xact_lock` eliminates a secondary distributed system dependency and guarantees lock lifecycle is strictly tied to database transaction commit/rollback. |
| **How do you handle Google Drive rate limits (10 req/sec)?** | We buffer file metadata locally in PostgreSQL. Search, pagination, sorting, and stats are 100% served from local indexed SQL tables. Google Drive is only touched during actual byte streaming or quota refresh. |
| **What happens if Google revokes a refresh token?** | The account status transitions to `ERROR`. The allocation engine skips errored nodes when balancing storage, and alerts the user to re-authenticate with zero impact on other accounts. |
| **Why use raw SQL instead of Prisma for everything?** | Prisma handles schema migrations cleanly, but raw SQL was required for atomic arithmetic (`reserved_bytes = reserved_bytes + $1`), advisory locks, `SKIP LOCKED`, and single-pass window functions (`COUNT(*) OVER ()`). |
