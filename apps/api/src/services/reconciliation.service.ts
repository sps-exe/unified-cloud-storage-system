// =============================================================================
// UCSS API — Reconciliation & Reliability Service
// =============================================================================
// Performs automated state recovery and background reconciliation:
//   1. Stuck Upload Recovery: detects files in PENDING/UPLOADING beyond threshold,
//      releases held byte reservations, and marks them FAILED.
//   2. Orphaned Reservation Recovery: resets reserved_bytes when no active uploads exist.
//   3. Periodic Quota Re-synchronization: refreshes Drive API quotas and saves time-series snapshots.
//   4. System Health Summary: single-pass audit of system consistency.
//
// RAW SQL USAGE:
// Implements reconciliation.sql using FOR UPDATE SKIP LOCKED, aggregate filters,
// and CTEs.
// =============================================================================

import { prisma } from '@ucss/database';
import { GoogleDriveService, isTokenRevokedError } from './google-drive.service.js';
import { AccountsService } from './accounts.service.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export interface StuckFileRecord {
  fileId: string;
  displayFilename: string;
  uploadStatus: string;
  sizeBytes: string;
  driveAccountId: string;
  googleEmail: string;
  stuckMinutes: number;
}

export interface ReconciledAccountRecord {
  accountId: string;
  googleEmail: string;
  previousReservedBytes: string;
  correctedReservedBytes: string;
}

export interface ReconciliationReport {
  timestamp: string;
  stuckUploadsRecovered: StuckFileRecord[];
  reservationsCorrected: ReconciledAccountRecord[];
  quotasSyncedCount: number;
}

export interface SystemHealthSummary {
  completedFiles: number;
  pendingFiles: number;
  uploadingFiles: number;
  failedFiles: number;
  orphanedFiles: number;
  cancelledFiles: number;
  deletedFiles: number;
  potentiallyStuckFiles: number;
  completedWithoutDriveId: number;
  totalManagedBytes: string;
  activeAccountsCount: number;
  totalQuotaBytes: string;
  totalUsedBytes: string;
  totalReservedBytes: string;
}

export class ReconciliationService {
  /**
   * Identifies and recovers stuck upload operations.
   * Releases byte reservations and sets status to FAILED.
   * Uses FOR UPDATE OF f SKIP LOCKED for safe concurrency across workers.
   */
  static async reconcileStuckUploads(options: {
    uploadingThresholdMinutes?: number;
    pendingThresholdMinutes?: number;
    batchSize?: number;
    userId?: string; // restrict to one user's files (omit for the system-wide worker)
  } = {}): Promise<StuckFileRecord[]> {
    const uploadingMinutes = options.uploadingThresholdMinutes ?? env.STUCK_UPLOAD_THRESHOLD_MINUTES;
    const pendingMinutes = options.pendingThresholdMinutes ?? env.STUCK_PENDING_THRESHOLD_MINUTES;
    const batchSize = options.batchSize ?? 50;
    const userId = options.userId ?? null;

    interface StuckRow {
      file_id: string;
      display_filename: string;
      upload_status: string;
      size_bytes: string;
      drive_account_id: string;
      google_email: string;
      stuck_minutes: number;
      latest_operation_id: string | null;
      user_id: string;
    }

    const recovered: StuckFileRecord[] = [];

    // Run in a single transaction with FOR UPDATE SKIP LOCKED
    await prisma.$transaction(async (tx) => {
      const stuckRows = await tx.$queryRaw<Array<StuckRow>>`
        SELECT
          f.id AS file_id,
          f.user_id,
          f.display_filename,
          f.upload_status::text,
          f.size_bytes::text,
          f.drive_account_id,
          da.google_email,
          (EXTRACT(EPOCH FROM (NOW() - f.updated_at)) / 60)::float AS stuck_minutes,
          uo.id AS latest_operation_id
        FROM files f
        JOIN drive_accounts da ON da.id = f.drive_account_id
        LEFT JOIN LATERAL (
          SELECT id
          FROM upload_operations
          WHERE file_id = f.id
          ORDER BY started_at DESC
          LIMIT 1
        ) uo ON TRUE
        WHERE
          f.is_deleted = FALSE
          AND (${userId}::uuid IS NULL OR f.user_id = ${userId}::uuid)
          AND (
            (f.upload_status = 'UPLOADING'::"UploadStatus" AND f.updated_at < NOW() - (${uploadingMinutes}::int || ' minutes')::interval)
            OR
            (f.upload_status = 'PENDING'::"UploadStatus" AND f.updated_at < NOW() - (${pendingMinutes}::int || ' minutes')::interval)
          )
        ORDER BY f.updated_at ASC
        LIMIT ${batchSize}::int
        FOR UPDATE OF f SKIP LOCKED;
      `;

      for (const row of stuckRows) {
        const sizeBytes = BigInt(row.size_bytes);

        // 1. Mark file FAILED
        await tx.$executeRaw`
          UPDATE files
          SET upload_status = 'FAILED'::"UploadStatus", updated_at = NOW()
          WHERE id = ${row.file_id}::uuid;
        `;

        // 2. Mark operation FAILED if present
        if (row.latest_operation_id) {
          await tx.$executeRaw`
            UPDATE upload_operations
            SET 
              status = 'FAILED'::"UploadStatus",
              error_message = 'Upload timed out and was aborted by reconciliation worker',
              error_code = 'UPLOAD_TIMEOUT',
              updated_at = NOW()
            WHERE id = ${row.latest_operation_id}::uuid;
          `;
        }

        // 3. Release held reservation
        await tx.$executeRaw`
          UPDATE drive_accounts
          SET 
            reserved_bytes = GREATEST(0::bigint, reserved_bytes - ${sizeBytes}::bigint),
            updated_at = NOW()
          WHERE id = ${row.drive_account_id}::uuid;
        `;

        // 4. Log audit entry
        await tx.$executeRaw`
          INSERT INTO audit_logs (
            id,
            user_id,
            action,
            resource_type,
            resource_id,
            metadata,
            created_at
          )
          VALUES (
            gen_random_uuid(),
            ${row.user_id}::uuid,
            'UPLOAD_ABORTED_STUCK',
            'FILE',
            ${row.file_id}::uuid,
            ${JSON.stringify({
              stuckMinutes: row.stuck_minutes,
              releasedBytes: row.size_bytes,
              previousStatus: row.upload_status,
            })}::json,
            NOW()
          );
        `;

        recovered.push({
          fileId: row.file_id,
          displayFilename: row.display_filename,
          uploadStatus: row.upload_status,
          sizeBytes: row.size_bytes,
          driveAccountId: row.drive_account_id,
          googleEmail: row.google_email,
          stuckMinutes: Math.round(row.stuck_minutes * 10) / 10,
        });
      }
    });

    if (recovered.length > 0) {
      logger.info({ count: recovered.length }, 'Reconciliation worker recovered stuck uploads');
    }

    return recovered;
  }

  /**
   * Resets orphaned byte reservations where reserved_bytes is non-zero
   * but does not match the actual in-flight file sum.
   */
  static async reconcileOrphanedReservations(userId: string | null = null): Promise<ReconciledAccountRecord[]> {
    interface DriftRow {
      account_id: string;
      google_email: string;
      user_id: string;
      reserved_bytes: string;
      actual_reserved_bytes: string;
    }

    const corrected: ReconciledAccountRecord[] = [];

    await prisma.$transaction(async (tx) => {
      const drifted = await tx.$queryRaw<Array<DriftRow>>`
        SELECT
          da.id AS account_id,
          da.google_email,
          da.user_id,
          da.reserved_bytes::text,
          COALESCE(SUM(f.size_bytes) FILTER (
            WHERE f.upload_status IN ('PENDING'::"UploadStatus", 'UPLOADING'::"UploadStatus") AND f.is_deleted = FALSE
          ), 0)::text AS actual_reserved_bytes
        FROM drive_accounts da
        LEFT JOIN files f ON f.drive_account_id = da.id
        WHERE
          da.reserved_bytes > 0
          AND (${userId}::uuid IS NULL OR da.user_id = ${userId}::uuid)
          AND da.status != 'DISCONNECTED'::"AccountStatus"
        GROUP BY da.id, da.google_email, da.user_id, da.reserved_bytes
        HAVING
          da.reserved_bytes != COALESCE(SUM(f.size_bytes) FILTER (
            WHERE f.upload_status IN ('PENDING'::"UploadStatus", 'UPLOADING'::"UploadStatus") AND f.is_deleted = FALSE
          ), 0);
      `;

      for (const row of drifted) {
        const correctVal = BigInt(row.actual_reserved_bytes);

        await tx.$executeRaw`
          UPDATE drive_accounts
          SET reserved_bytes = ${correctVal}::bigint, updated_at = NOW()
          WHERE id = ${row.account_id}::uuid;
        `;

        await tx.$executeRaw`
          INSERT INTO audit_logs (
            id,
            user_id,
            action,
            resource_type,
            resource_id,
            metadata,
            created_at
          )
          VALUES (
            gen_random_uuid(),
            ${row.user_id}::uuid,
            'RESERVATION_RECONCILED',
            'DRIVE_ACCOUNT',
            ${row.account_id}::uuid,
            ${JSON.stringify({
              previousReservedBytes: row.reserved_bytes,
              correctedReservedBytes: row.actual_reserved_bytes,
            })}::json,
            NOW()
          );
        `;

        corrected.push({
          accountId: row.account_id,
          googleEmail: row.google_email,
          previousReservedBytes: row.reserved_bytes,
          correctedReservedBytes: row.actual_reserved_bytes,
        });
      }
    });

    if (corrected.length > 0) {
      logger.info({ count: corrected.length }, 'Corrected orphaned byte reservations');
    }

    return corrected;
  }

  /**
   * Periodically re-syncs all active Drive account quotas with Google Drive API
   * and saves point-in-time time-series snapshots.
   */
  static async syncAllAccountQuotas(userId: string | null = null): Promise<number> {
    interface AccountSyncTarget {
      id: string;
      user_id: string;
      encrypted_refresh_token: string;
      google_email: string;
    }

    const accounts = await prisma.$queryRaw<Array<AccountSyncTarget>>`
      SELECT id, user_id, encrypted_refresh_token, google_email
      FROM drive_accounts
      WHERE status = 'ACTIVE'::"AccountStatus"
        AND (${userId}::uuid IS NULL OR user_id = ${userId}::uuid);
    `;

    let syncedCount = 0;
    const BATCH_CONCURRENCY = 10;

    for (let i = 0; i < accounts.length; i += BATCH_CONCURRENCY) {
      const slice = accounts.slice(i, i + BATCH_CONCURRENCY);
      await Promise.allSettled(
        slice.map(async (acc) => {
          try {
            const quota = await GoogleDriveService.fetchStorageQuota(acc.encrypted_refresh_token);

            const [fileCountRow] = await prisma.$queryRaw<Array<{ count: string }>>`
              SELECT COUNT(*)::text AS count
              FROM files
              WHERE drive_account_id = ${acc.id}::uuid AND upload_status = 'COMPLETED'::"UploadStatus" AND is_deleted = FALSE;
            `;
            const managedCount = parseInt(fileCountRow?.count || '0', 10);

            await prisma.$transaction(async (tx) => {
              // 1. Update account record
              await tx.$executeRaw`
                UPDATE drive_accounts
                SET 
                  quota_limit_bytes = ${quota.quotaLimitBytes}::bigint,
                  quota_used_bytes = ${quota.quotaUsedBytes}::bigint,
                  quota_last_synced_at = NOW(),
                  last_verified_at = NOW(),
                  updated_at = NOW()
                WHERE id = ${acc.id}::uuid;
              `;

              // 2. Append time-series snapshot
              await tx.$executeRaw`
                INSERT INTO storage_snapshots (
                  id,
                  drive_account_id,
                  quota_limit_bytes,
                  quota_used_bytes,
                  usage_in_drive,
                  usage_in_trash,
                  managed_file_count,
                  captured_at
                )
                VALUES (
                  gen_random_uuid(),
                  ${acc.id}::uuid,
                  ${quota.quotaLimitBytes}::bigint,
                  ${quota.quotaUsedBytes}::bigint,
                  ${quota.usageInDrive}::bigint,
                  ${quota.usageInTrash}::bigint,
                  ${managedCount}::int,
                  NOW()
                );
              `;
            });

            syncedCount++;
          } catch (err) {
            if (isTokenRevokedError(err)) {
              await AccountsService.markTokenExpired(acc.user_id, acc.id);
            } else {
              logger.warn({ accountId: acc.id, email: acc.google_email, error: err }, 'Failed to sync account quota');
            }
          }
        })
      );
    }

    return syncedCount;
  }

  /**
   * Runs the complete reconciliation sequence.
   */
  static async runFullReconciliation(options?: {
    uploadingThresholdMinutes?: number;
    pendingThresholdMinutes?: number;
    userId?: string;
  }): Promise<ReconciliationReport> {
    const stuck = await this.reconcileStuckUploads(options);
    const reservations = await this.reconcileOrphanedReservations(options?.userId ?? null);
    const quotasCount = await this.syncAllAccountQuotas(options?.userId ?? null);

    return {
      timestamp: new Date().toISOString(),
      stuckUploadsRecovered: stuck,
      reservationsCorrected: reservations,
      quotasSyncedCount: quotasCount,
    };
  }

  /**
   * Retrieves high-level consistency and health metrics.
   */
  static async getHealthSummary(userId: string | null = null): Promise<SystemHealthSummary> {
    interface SummaryRow {
      completed_files: string;
      pending_files: string;
      uploading_files: string;
      failed_files: string;
      orphaned_files: string;
      cancelled_files: string;
      deleted_files: string;
      potentially_stuck_files: string;
      completed_without_drive_id: string;
      total_managed_bytes: string;
    }

    const [fileSummary] = await prisma.$queryRaw<Array<SummaryRow>>`
      SELECT
        COUNT(*) FILTER (WHERE upload_status = 'COMPLETED'::"UploadStatus" AND is_deleted = FALSE)::text AS completed_files,
        COUNT(*) FILTER (WHERE upload_status = 'PENDING'::"UploadStatus")::text   AS pending_files,
        COUNT(*) FILTER (WHERE upload_status = 'UPLOADING'::"UploadStatus")::text AS uploading_files,
        COUNT(*) FILTER (WHERE upload_status = 'FAILED'::"UploadStatus")::text    AS failed_files,
        COUNT(*) FILTER (WHERE upload_status = 'ORPHANED'::"UploadStatus")::text  AS orphaned_files,
        COUNT(*) FILTER (WHERE upload_status = 'CANCELLED'::"UploadStatus")::text AS cancelled_files,
        COUNT(*) FILTER (WHERE is_deleted = TRUE)::text            AS deleted_files,
        COUNT(*) FILTER (
          WHERE upload_status = 'UPLOADING'::"UploadStatus"
          AND updated_at < NOW() - INTERVAL '30 minutes'
        )::text AS potentially_stuck_files,
        COUNT(*) FILTER (
          WHERE upload_status = 'COMPLETED'::"UploadStatus"
          AND drive_file_id IS NULL
        )::text AS completed_without_drive_id,
        COALESCE(SUM(size_bytes) FILTER (
          WHERE upload_status = 'COMPLETED'::"UploadStatus" AND is_deleted = FALSE
        ), 0)::text AS total_managed_bytes
      FROM files
      WHERE (${userId}::uuid IS NULL OR user_id = ${userId}::uuid);
    `;

    interface AccountOverviewRow {
      active_accounts_count: string;
      total_quota_bytes: string;
      total_used_bytes: string;
      total_reserved_bytes: string;
    }

    const [accountSummary] = await prisma.$queryRaw<Array<AccountOverviewRow>>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ACTIVE'::"AccountStatus")::text AS active_accounts_count,
        COALESCE(SUM(quota_limit_bytes) FILTER (WHERE status = 'ACTIVE'::"AccountStatus"), 0)::text AS total_quota_bytes,
        COALESCE(SUM(quota_used_bytes) FILTER (WHERE status = 'ACTIVE'::"AccountStatus"), 0)::text AS total_used_bytes,
        COALESCE(SUM(reserved_bytes) FILTER (WHERE status = 'ACTIVE'::"AccountStatus"), 0)::text AS total_reserved_bytes
      FROM drive_accounts
      WHERE (${userId}::uuid IS NULL OR user_id = ${userId}::uuid);
    `;

    return {
      completedFiles: parseInt(fileSummary?.completed_files || '0', 10),
      pendingFiles: parseInt(fileSummary?.pending_files || '0', 10),
      uploadingFiles: parseInt(fileSummary?.uploading_files || '0', 10),
      failedFiles: parseInt(fileSummary?.failed_files || '0', 10),
      orphanedFiles: parseInt(fileSummary?.orphaned_files || '0', 10),
      cancelledFiles: parseInt(fileSummary?.cancelled_files || '0', 10),
      deletedFiles: parseInt(fileSummary?.deleted_files || '0', 10),
      potentiallyStuckFiles: parseInt(fileSummary?.potentially_stuck_files || '0', 10),
      completedWithoutDriveId: parseInt(fileSummary?.completed_without_drive_id || '0', 10),
      totalManagedBytes: fileSummary?.total_managed_bytes || '0',
      activeAccountsCount: parseInt(accountSummary?.active_accounts_count || '0', 10),
      totalQuotaBytes: accountSummary?.total_quota_bytes || '0',
      totalUsedBytes: accountSummary?.total_used_bytes || '0',
      totalReservedBytes: accountSummary?.total_reserved_bytes || '0',
    };
  }
}
