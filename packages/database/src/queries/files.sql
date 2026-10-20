-- =============================================================================
-- UCSS — Raw SQL Queries
-- File: files.sql
--
-- PURPOSE: File listing, search, and reporting queries.
-- These use full-text search, CTEs, and window functions for analytics.
-- =============================================================================

-- =============================================================================
-- QUERY 1: FILE_LIST_WITH_ACCOUNT (Paginated)
-- Main query for the file library. Returns files with their account info.
-- Supports: search, MIME filter, account filter, sort, pagination.
-- Uses partial index: idx_files_user_active.
--
-- PARAMETERS:
--   $1 = userId (UUID)
--   $2 = searchQuery (TEXT | NULL) — partial name match
--   $3 = mimeTypeFilter (TEXT | NULL) — e.g., 'video/%' or 'image/jpeg'
--   $4 = driveAccountId (UUID | NULL) — filter to single account
--   $5 = sortColumn (TEXT) — 'display_filename', 'size_bytes', 'created_at'
--   $6 = sortDir (TEXT) — 'ASC' or 'DESC'
--   $7 = pageSize (INT)
--   $8 = offset (INT) — (page - 1) * pageSize
-- =============================================================================
SELECT
  f.id,
  f.drive_account_id,
  da.google_email AS drive_account_email,
  f.original_filename,
  f.display_filename,
  f.mime_type,
  f.size_bytes,
  f.upload_status,
  f.checksum_sha256,
  f.created_at,
  f.updated_at,
  -- Total count for pagination (window function — no second query needed)
  COUNT(*) OVER () AS total_count
FROM files f
JOIN drive_accounts da ON da.id = f.drive_account_id
WHERE
  f.user_id = $1::UUID
  AND f.is_deleted = FALSE
  AND f.upload_status = 'COMPLETED'
  -- Search: case-insensitive partial match on display filename
  AND ($2::TEXT IS NULL OR f.display_filename ILIKE '%' || $2 || '%')
  -- MIME type filter: supports wildcards via LIKE (e.g., 'image/%')
  AND ($3::TEXT IS NULL OR f.mime_type LIKE $3)
  -- Account filter
  AND ($4::UUID IS NULL OR f.drive_account_id = $4::UUID)
ORDER BY
  -- Dynamic sort — use CASE to avoid SQL injection via column name
  CASE WHEN $5 = 'display_filename' AND $6 = 'ASC'  THEN f.display_filename END ASC,
  CASE WHEN $5 = 'display_filename' AND $6 = 'DESC' THEN f.display_filename END DESC,
  CASE WHEN $5 = 'size_bytes'       AND $6 = 'ASC'  THEN f.size_bytes END ASC,
  CASE WHEN $5 = 'size_bytes'       AND $6 = 'DESC' THEN f.size_bytes END DESC,
  CASE WHEN $5 = 'created_at'       AND $6 = 'ASC'  THEN f.created_at END ASC,
  CASE WHEN $5 = 'created_at'       AND $6 = 'DESC' THEN f.created_at END DESC,
  -- Default: newest first
  f.created_at DESC
LIMIT $7::INT
OFFSET $8::INT;


-- =============================================================================
-- QUERY 2: STORAGE_ANALYTICS_BY_MIME_TYPE
-- Breakdown of storage usage by MIME type category.
-- Groups e.g. 'image/jpeg', 'image/png' into 'Images'.
-- Showcases CASE expressions and aggregate functions.
--
-- PARAMETERS:
--   $1 = userId (UUID)
-- =============================================================================
SELECT
  -- Group MIME types into human-readable categories
  CASE
    WHEN f.mime_type LIKE 'image/%'       THEN 'Images'
    WHEN f.mime_type LIKE 'video/%'       THEN 'Videos'
    WHEN f.mime_type LIKE 'audio/%'       THEN 'Audio'
    WHEN f.mime_type LIKE 'text/%'        THEN 'Documents'
    WHEN f.mime_type LIKE 'application/pdf' THEN 'Documents'
    WHEN f.mime_type LIKE 'application/zip'
      OR f.mime_type LIKE 'application/x-rar%'
      OR f.mime_type LIKE 'application/x-tar' THEN 'Archives'
    ELSE 'Other'
  END AS category,
  COUNT(*) AS file_count,
  SUM(f.size_bytes) AS total_bytes,
  AVG(f.size_bytes)::BIGINT AS avg_file_bytes,
  MAX(f.size_bytes) AS largest_file_bytes,
  -- Percentage of total storage
  ROUND(
    SUM(f.size_bytes) * 100.0 / NULLIF(SUM(SUM(f.size_bytes)) OVER (), 0),
    2
  ) AS pct_of_total
FROM files f
WHERE
  f.user_id = $1::UUID
  AND f.is_deleted = FALSE
  AND f.upload_status = 'COMPLETED'
GROUP BY category
ORDER BY total_bytes DESC;


-- =============================================================================
-- QUERY 3: UPLOAD_PERFORMANCE_METRICS
-- Time-series of upload success/failure rates.
-- Useful for monitoring and the admin dashboard.
--
-- PARAMETERS:
--   $1 = userId (UUID)
--   $2 = daysBack (INT) — e.g., 30 for last 30 days
-- =============================================================================
WITH daily_uploads AS (
  SELECT
    DATE_TRUNC('day', uo.started_at) AS day,
    COUNT(*) AS total_attempts,
    COUNT(*) FILTER (WHERE uo.status = 'COMPLETED') AS successful,
    COUNT(*) FILTER (WHERE uo.status = 'FAILED') AS failed,
    COUNT(*) FILTER (WHERE uo.status = 'ORPHANED') AS orphaned,
    AVG(uo.duration_ms) FILTER (WHERE uo.status = 'COMPLETED')::INT AS avg_duration_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY uo.duration_ms)
      FILTER (WHERE uo.status = 'COMPLETED') AS p95_duration_ms,
    SUM(f.size_bytes) FILTER (WHERE uo.status = 'COMPLETED') AS bytes_uploaded
  FROM upload_operations uo
  JOIN files f ON f.id = uo.file_id
  WHERE
    f.user_id = $1::UUID
    AND uo.started_at >= NOW() - ($2::INT || ' days')::INTERVAL
  GROUP BY day
)
SELECT
  day,
  total_attempts,
  successful,
  failed,
  orphaned,
  -- Success rate as percentage
  ROUND(successful * 100.0 / NULLIF(total_attempts, 0), 2) AS success_rate_pct,
  avg_duration_ms,
  p95_duration_ms,
  bytes_uploaded,
  -- 7-day rolling average of success rate (window function)
  ROUND(
    AVG(successful * 100.0 / NULLIF(total_attempts, 0))
      OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),
    2
  ) AS rolling_7d_success_rate
FROM daily_uploads
ORDER BY day DESC;
