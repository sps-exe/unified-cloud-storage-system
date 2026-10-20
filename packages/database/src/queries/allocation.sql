-- =============================================================================
-- UCSS — Raw SQL Queries
-- File: allocation.sql
--
-- PURPOSE: Storage allocation engine queries.
-- These queries use PostgreSQL-specific features that Prisma's ORM layer
-- cannot express: advisory locks, CTEs with side effects, RETURNING clauses
-- combined with aggregations, and conditional UPDATE logic.
--
-- ALL queries here are used via prisma.$queryRaw or pg.Pool in:
--   packages/database/src/queries/allocation.ts
-- =============================================================================

-- =============================================================================
-- QUERY 1: SELECT_ELIGIBLE_ACCOUNTS
-- Find all accounts that can receive a file of :fileSizeBytes bytes.
-- Returns accounts sorted by most available capacity (best-fit secondary).
-- Primary sort: most available space first (maximizes utilization spread).
--
-- PARAMETERS:
--   $1 = userId (UUID)
--   $2 = fileSizeBytes (BIGINT)
--   $3 = safetyMarginBytes (BIGINT) — minimum free space to always reserve
--   $4 = maxQuotaAgeSeconds (INT)   — reject quota data older than this
-- =============================================================================
SELECT
  da.id,
  da.google_email,
  da.status,
  da.quota_limit_bytes,
  da.quota_used_bytes,
  da.reserved_bytes,
  -- Effective available space = limit - used - reserved - safety_margin
  (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes - $3::BIGINT) AS effective_available_bytes,
  -- Staleness flag: true if quota was synced more than N seconds ago
  (EXTRACT(EPOCH FROM (NOW() - da.quota_last_synced_at)) > $4::INT) AS quota_is_stale,
  da.quota_last_synced_at
FROM drive_accounts da
WHERE
  da.user_id = $1::UUID
  AND da.status = 'ACTIVE'
  -- Sufficient space check (accounting for reserved bytes and safety margin)
  AND (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes - $3::BIGINT) >= $2::BIGINT
  -- Account must have been verified recently (token not expired)
  AND da.last_verified_at IS NOT NULL
  AND da.last_verified_at > NOW() - INTERVAL '24 hours'
ORDER BY
  -- Sort by effective available space descending (most roomy account first)
  effective_available_bytes DESC,
  -- Tiebreak: least recently used (spread load across accounts)
  da.quota_last_synced_at ASC NULLS LAST;


-- =============================================================================
-- QUERY 2: RESERVE_BYTES_WITH_ADVISORY_LOCK
-- Atomically reserve bytes on a specific account for an in-flight upload.
-- Uses pg_advisory_xact_lock to prevent concurrent over-allocation.
--
-- HOW IT WORKS:
--   1. Acquire an advisory lock keyed to the account ID hash.
--      This blocks any other concurrent transaction trying to reserve
--      bytes on the SAME account until we commit or rollback.
--   2. Re-verify capacity inside the lock (double-check after lock acquired).
--   3. Increment reserved_bytes atomically.
--   4. Return the updated row for confirmation.
--
-- This must run inside a BEGIN/COMMIT block in the application.
--
-- PARAMETERS:
--   $1 = driveAccountId (UUID)
--   $2 = fileSizeBytes (BIGINT)
--   $3 = safetyMarginBytes (BIGINT)
--
-- RETURNS: updated drive_accounts row, or 0 rows if capacity check fails.
-- =============================================================================
SELECT pg_advisory_xact_lock(
  -- Hash the UUID to a stable INT8 for the lock key.
  -- We XOR the two 4-byte halves of a SHA256 hash truncated to 8 bytes.
  ('x' || SUBSTR(ENCODE(DIGEST($1::TEXT, 'sha256'), 'hex'), 1, 16))::BIT(64)::BIGINT
);

UPDATE drive_accounts
SET
  reserved_bytes = reserved_bytes + $2::BIGINT,
  updated_at = NOW()
WHERE
  id = $1::UUID
  AND status = 'ACTIVE'
  -- Re-verify inside the lock that capacity is still sufficient
  AND (quota_limit_bytes - quota_used_bytes - reserved_bytes - $3::BIGINT) >= $2::BIGINT
RETURNING
  id,
  google_email,
  quota_limit_bytes,
  quota_used_bytes,
  reserved_bytes,
  (quota_limit_bytes - quota_used_bytes - reserved_bytes) AS available_after_reservation;


-- =============================================================================
-- QUERY 3: RELEASE_RESERVATION
-- Called after upload COMPLETES or FAILS. Adjusts reserved_bytes and
-- optionally updates quota_used_bytes with the confirmed Drive API value.
--
-- Two variants:
--   A: On SUCCESS — decrement reserved, update used_bytes with Drive's value
--   B: On FAILURE — just decrement reserved, used_bytes unchanged
--
-- PARAMETERS (SUCCESS):
--   $1 = driveAccountId (UUID)
--   $2 = fileSizeBytes (BIGINT) — amount to release from reserved
--   $3 = confirmedUsedBytes (BIGINT) — actual used_bytes from Drive API /about
-- =============================================================================

-- Variant A: SUCCESS — release reservation, update actual usage from Drive API
UPDATE drive_accounts
SET
  reserved_bytes = GREATEST(0, reserved_bytes - $2::BIGINT),
  quota_used_bytes = $3::BIGINT,
  quota_last_synced_at = NOW(),
  updated_at = NOW()
WHERE id = $1::UUID;

-- Variant B: FAILURE — just release the reservation
UPDATE drive_accounts
SET
  reserved_bytes = GREATEST(0, reserved_bytes - $2::BIGINT),
  updated_at = NOW()
WHERE id = $1::UUID;


-- =============================================================================
-- QUERY 4: STORAGE_SUMMARY_BY_USER
-- Aggregated storage summary across all connected accounts.
-- Used for the dashboard "total storage" widget.
-- Uses window functions to compute per-account AND total in a single pass.
--
-- PARAMETERS:
--   $1 = userId (UUID)
-- =============================================================================
SELECT
  -- Per-account breakdown
  da.id AS account_id,
  da.google_email,
  da.status,
  da.quota_limit_bytes,
  da.quota_used_bytes,
  da.reserved_bytes,
  (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes) AS effective_available_bytes,
  -- File count managed by UCSS in this account
  COUNT(f.id) FILTER (WHERE f.is_deleted = FALSE AND f.upload_status = 'COMPLETED') AS managed_file_count,
  -- Total bytes of UCSS-managed files (should approximate quota_used_bytes)
  COALESCE(SUM(f.size_bytes) FILTER (WHERE f.is_deleted = FALSE AND f.upload_status = 'COMPLETED'), 0) AS managed_bytes,
  -- Running totals across all accounts (window functions)
  SUM(da.quota_limit_bytes) OVER () AS total_quota_bytes,
  SUM(da.quota_used_bytes) OVER () AS total_used_bytes,
  SUM(da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes) OVER () AS total_available_bytes,
  SUM(da.reserved_bytes) OVER () AS total_reserved_bytes
FROM drive_accounts da
LEFT JOIN files f ON f.drive_account_id = da.id
WHERE
  da.user_id = $1::UUID
  AND da.status != 'DISCONNECTED'
GROUP BY
  da.id, da.google_email, da.status,
  da.quota_limit_bytes, da.quota_used_bytes, da.reserved_bytes
ORDER BY da.connected_at ASC;
