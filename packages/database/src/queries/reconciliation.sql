-- =============================================================================
-- UCSS — Raw SQL Queries
-- File: reconciliation.sql
--
-- PURPOSE: Detect inconsistencies between PostgreSQL and Google Drive.
-- These queries identify four classes of problems:
--   1. GHOST RECORDS: DB says file exists; Drive says it doesn't
--   2. STUCK UPLOADS: File stuck in UPLOADING/PENDING too long
--   3. QUOTA DRIFT: DB usage estimate differs significantly from Drive API
--   4. ORPHANED RESERVATIONS: reserved_bytes > 0 but no active uploads
--
-- All queries use FOR UPDATE SKIP LOCKED for safe concurrent workers.
-- =============================================================================

-- =============================================================================
-- QUERY 1: FIND_STUCK_UPLOADS
-- Files that have been in UPLOADING or PENDING state for too long.
-- These are candidates for the reconciliation worker to investigate.
-- "Too long" = configurable threshold (default: 30 minutes for UPLOADING,
--               5 minutes for PENDING).
--
-- Uses FOR UPDATE SKIP LOCKED so multiple reconciliation workers don't
-- process the same stuck file simultaneously.
--
-- PARAMETERS:
--   $1 = uploadingThresholdMinutes (INT) — default 30
--   $2 = pendingThresholdMinutes (INT)   — default 5
--   $3 = batchSize (INT)                 — how many to process at once
-- =============================================================================
SELECT
  f.id AS file_id,
  f.display_filename,
  f.upload_status,
  f.size_bytes,
  f.drive_account_id,
  f.drive_file_id,
  da.google_email,
  -- How long has this been stuck?
  EXTRACT(EPOCH FROM (NOW() - f.updated_at)) / 60 AS stuck_minutes,
  uo.id AS latest_operation_id,
  uo.retry_count,
  uo.max_retries,
  uo.error_message
FROM files f
JOIN drive_accounts da ON da.id = f.drive_account_id
LEFT JOIN LATERAL (
  -- Get the most recent upload operation for this file
  SELECT id, retry_count, max_retries, error_message
  FROM upload_operations
  WHERE file_id = f.id
  ORDER BY started_at DESC
  LIMIT 1
) uo ON TRUE
WHERE
  f.is_deleted = FALSE
  AND (
    -- UPLOADING for too long
    (f.upload_status = 'UPLOADING' AND f.updated_at < NOW() - ($1::INT || ' minutes')::INTERVAL)
    OR
    -- PENDING for too long (allocation succeeded but upload never started)
    (f.upload_status = 'PENDING' AND f.updated_at < NOW() - ($2::INT || ' minutes')::INTERVAL)
  )
ORDER BY f.updated_at ASC
LIMIT $3::INT
FOR UPDATE OF f SKIP LOCKED;


-- =============================================================================
-- QUERY 2: FIND_ORPHANED_RESERVATIONS
-- Accounts with reserved_bytes > 0 but no active (PENDING/UPLOADING) files.
-- This indicates a crash or bug left the reservation counter stuck.
-- Safe to reset reserved_bytes to 0 for these accounts.
-- =============================================================================
SELECT
  da.id AS account_id,
  da.google_email,
  da.reserved_bytes,
  da.quota_used_bytes,
  da.quota_limit_bytes,
  -- Count of actually active uploads (should be > 0 if reservation is legitimate)
  COUNT(f.id) FILTER (
    WHERE f.upload_status IN ('PENDING', 'UPLOADING') AND f.is_deleted = FALSE
  ) AS active_upload_count,
  -- Sum of bytes actually in-flight (should equal reserved_bytes if consistent)
  COALESCE(SUM(f.size_bytes) FILTER (
    WHERE f.upload_status IN ('PENDING', 'UPLOADING') AND f.is_deleted = FALSE
  ), 0) AS actual_reserved_bytes
FROM drive_accounts da
LEFT JOIN files f ON f.drive_account_id = da.id
WHERE
  da.reserved_bytes > 0
  AND da.status != 'DISCONNECTED'
GROUP BY da.id, da.google_email, da.reserved_bytes, da.quota_used_bytes, da.quota_limit_bytes
HAVING
  -- Orphaned: reserved > 0 but no active uploads
  COUNT(f.id) FILTER (WHERE f.upload_status IN ('PENDING', 'UPLOADING') AND f.is_deleted = FALSE) = 0
  OR
  -- Drift: reserved != sum of actual in-flight files
  da.reserved_bytes != COALESCE(SUM(f.size_bytes) FILTER (
    WHERE f.upload_status IN ('PENDING', 'UPLOADING') AND f.is_deleted = FALSE
  ), 0);


-- =============================================================================
-- QUERY 3: RESET_ORPHANED_RESERVATION
-- Called by reconciliation worker after confirming an account's reservation
-- is orphaned. Resets reserved_bytes to the actual computed value.
--
-- PARAMETERS:
--   $1 = driveAccountId (UUID)
--   $2 = correctedReservedBytes (BIGINT) — actual sum of in-flight file sizes
-- =============================================================================
UPDATE drive_accounts
SET
  reserved_bytes = $2::BIGINT,
  updated_at = NOW()
WHERE id = $1::UUID
RETURNING id, google_email, reserved_bytes;


-- =============================================================================
-- QUERY 4: MARK_FILE_ORPHANED
-- Called when reconciliation confirms a file record exists in DB but
-- the corresponding Drive file does not exist (ghost record).
-- Also called when Drive file exists but no DB record (orphan on Drive).
--
-- PARAMETERS:
--   $1 = fileId (UUID)
--   $2 = reason (TEXT) — human-readable explanation for audit
-- =============================================================================
UPDATE files
SET
  upload_status = 'ORPHANED',
  updated_at = NOW()
WHERE id = $1::UUID
RETURNING id, display_filename, upload_status;

-- Log this event in audit_logs
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
SELECT
  f.user_id,
  'FILE_ORPHANED',
  'file',
  f.id,
  jsonb_build_object(
    'reason', $2::TEXT,
    'previousStatus', f.upload_status,
    'driveFileId', f.drive_file_id,
    'detectedAt', NOW()
  )
FROM files f
WHERE f.id = $1::UUID;


-- =============================================================================
-- QUERY 5: RECONCILIATION_SUMMARY
-- Overview of the system's consistency health.
-- Returns counts of files in each state — used by /admin/health endpoint.
-- =============================================================================
SELECT
  -- Upload status distribution
  COUNT(*) FILTER (WHERE upload_status = 'COMPLETED' AND is_deleted = FALSE)  AS completed_files,
  COUNT(*) FILTER (WHERE upload_status = 'PENDING')   AS pending_files,
  COUNT(*) FILTER (WHERE upload_status = 'UPLOADING')  AS uploading_files,
  COUNT(*) FILTER (WHERE upload_status = 'FAILED')     AS failed_files,
  COUNT(*) FILTER (WHERE upload_status = 'ORPHANED')   AS orphaned_files,
  COUNT(*) FILTER (WHERE upload_status = 'CANCELLED')  AS cancelled_files,
  -- Soft deleted
  COUNT(*) FILTER (WHERE is_deleted = TRUE)            AS deleted_files,
  -- Potentially stuck: uploading for > 30 min
  COUNT(*) FILTER (
    WHERE upload_status = 'UPLOADING'
    AND updated_at < NOW() - INTERVAL '30 minutes'
  ) AS potentially_stuck_files,
  -- Data consistency: completed files with no driveFileId (should be 0)
  COUNT(*) FILTER (
    WHERE upload_status = 'COMPLETED'
    AND drive_file_id IS NULL
  ) AS completed_without_drive_id,
  -- Total storage managed
  COALESCE(SUM(size_bytes) FILTER (
    WHERE upload_status = 'COMPLETED' AND is_deleted = FALSE
  ), 0) AS total_managed_bytes
FROM files;
