// =============================================================================
// UCSS API — Accounts Management Service
// =============================================================================
// Manages connected Google Drive accounts: listing, syncing, disconnecting,
// and storage snapshots.
//
// RAW SQL USAGE:
// Uses prisma.$queryRaw for high-performance CTEs and atomic upserts.
// =============================================================================

import { prisma } from '@ucss/database';
import { GoogleDriveService, isTokenRevokedError } from './google-drive.service.js';
import { NotFoundError, AppError, ConflictError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { DriveAccountDto, AccountStatus } from '@ucss/shared';

export interface AccountDetailDto extends DriveAccountDto {
  fileCount: number;
}

export class AccountsService {
  /**
   * Connects a Google Drive account using the OAuth authorization code.
   * Performs an atomic PostgreSQL UPSERT on (user_id, google_account_id).
   */
  static async connectAccount(
    userId: string,
    code: string,
  ): Promise<DriveAccountDto> {
    const googleData = await GoogleDriveService.handleOAuthCallback(code);

    interface UpsertRow {
      id: string;
      google_email: string;
      status: AccountStatus;
      quota_limit_bytes: string;
      quota_used_bytes: string;
      reserved_bytes: string;
      quota_available_bytes: string;
      quota_last_synced_at: Date | null;
      connected_at: Date;
      last_verified_at: Date | null;
    }

    // Atomic SQL UPSERT
    const [row] = await prisma.$queryRaw<Array<UpsertRow>>`
      INSERT INTO drive_accounts (
        id,
        user_id,
        google_email,
        google_account_id,
        encrypted_refresh_token,
        status,
        quota_limit_bytes,
        quota_used_bytes,
        reserved_bytes,
        quota_last_synced_at,
        connected_at,
        updated_at,
        last_verified_at
      )
      VALUES (
        gen_random_uuid(),
        ${userId}::uuid,
        ${googleData.googleEmail},
        ${googleData.googleAccountId},
        ${googleData.encryptedRefreshToken},
        'ACTIVE'::"AccountStatus",
        ${googleData.quotaLimitBytes},
        ${googleData.quotaUsedBytes},
        0::bigint,
        NOW(),
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id, google_account_id) DO UPDATE SET
        encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
        status = 'ACTIVE'::"AccountStatus",
        quota_limit_bytes = EXCLUDED.quota_limit_bytes,
        quota_used_bytes = EXCLUDED.quota_used_bytes,
        quota_last_synced_at = NOW(),
        updated_at = NOW(),
        last_verified_at = NOW(),
        disconnected_at = NULL
      RETURNING 
        id,
        google_email,
        status,
        quota_limit_bytes::text,
        quota_used_bytes::text,
        reserved_bytes::text,
        GREATEST(0::bigint, quota_limit_bytes - quota_used_bytes - reserved_bytes)::text AS quota_available_bytes,
        quota_last_synced_at,
        connected_at,
        last_verified_at;
    `;

    if (!row) {
      throw new AppError(500, 'ACCOUNT_CONNECT_FAILED', 'Failed to save connected account');
    }

    // Capture initial storage snapshot
    await prisma.$executeRaw`
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
        ${row.id}::uuid,
        ${googleData.quotaLimitBytes},
        ${googleData.quotaUsedBytes},
        ${googleData.quotaUsedBytes},
        0::bigint,
        0,
        NOW()
      );
    `;

    // Audit log
    await prisma.$executeRaw`
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
        ${userId}::uuid,
        'ACCOUNT_CONNECTED',
        'DRIVE_ACCOUNT',
        ${row.id}::uuid,
        ${JSON.stringify({ googleEmail: row.google_email })}::json,
        NOW()
      );
    `;

    logger.info({ accountId: row.id, googleEmail: row.google_email }, 'Drive account connected');

    return {
      id: row.id,
      googleEmail: row.google_email,
      status: row.status,
      quotaLimitBytes: row.quota_limit_bytes,
      quotaUsedBytes: row.quota_used_bytes,
      quotaAvailableBytes: row.quota_available_bytes,
      reservedBytes: row.reserved_bytes,
      quotaLastSyncedAt: row.quota_last_synced_at ? row.quota_last_synced_at.toISOString() : null,
      connectedAt: row.connected_at.toISOString(),
      lastVerifiedAt: row.last_verified_at ? row.last_verified_at.toISOString() : null,
    };
  }

  /** Flags an account whose Google refresh token was revoked/expired so the UI prompts a reconnect. */
  static async markTokenExpired(userId: string, accountId: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE drive_accounts
      SET status = 'TOKEN_EXPIRED'::"AccountStatus", updated_at = NOW()
      WHERE id = ${accountId}::uuid AND status = 'ACTIVE'::"AccountStatus";
    `;
    await prisma.$executeRaw`
      INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, 'ACCOUNT_TOKEN_EXPIRED', 'DRIVE_ACCOUNT', ${accountId}::uuid,
              '{"reason": "Google refresh token revoked or invalid_grant"}'::json, NOW());
    `;
    logger.warn({ accountId }, 'Drive account token expired — status set to TOKEN_EXPIRED');
  }

  /**
   * Lists all connected Google Drive accounts for a user with available headroom
   * and live file counts.
   */
  static async listAccounts(userId: string): Promise<AccountDetailDto[]> {
    interface AccountListRow {
      id: string;
      google_email: string;
      status: AccountStatus;
      quota_limit_bytes: string;
      quota_used_bytes: string;
      reserved_bytes: string;
      quota_available_bytes: string;
      quota_last_synced_at: Date | null;
      connected_at: Date;
      last_verified_at: Date | null;
      file_count: number;
    }

    const rows = await prisma.$queryRaw<Array<AccountListRow>>`
      SELECT 
        da.id,
        da.google_email,
        da.status,
        da.quota_limit_bytes::text,
        da.quota_used_bytes::text,
        da.reserved_bytes::text,
        GREATEST(
          0::bigint, 
          da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes
        )::text AS quota_available_bytes,
        da.quota_last_synced_at,
        da.connected_at,
        da.last_verified_at,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM files f
            WHERE f.drive_account_id = da.id AND f.is_deleted = FALSE
          ),
          0
        ) AS file_count
      FROM drive_accounts da
      WHERE da.user_id = ${userId}::uuid
      ORDER BY da.connected_at ASC;
    `;

    return rows.map((r) => ({
      id: r.id,
      googleEmail: r.google_email,
      status: r.status,
      quotaLimitBytes: r.quota_limit_bytes,
      quotaUsedBytes: r.quota_used_bytes,
      quotaAvailableBytes: r.quota_available_bytes,
      reservedBytes: r.reserved_bytes,
      quotaLastSyncedAt: r.quota_last_synced_at ? r.quota_last_synced_at.toISOString() : null,
      connectedAt: r.connected_at.toISOString(),
      lastVerifiedAt: r.last_verified_at ? r.last_verified_at.toISOString() : null,
      fileCount: r.file_count,
    }));
  }

  /**
   * Forces a live quota sync with the Google Drive API.
   */
  static async syncAccount(
    userId: string,
    accountId: string,
  ): Promise<DriveAccountDto> {
    const [account] = await prisma.$queryRaw<
      Array<{ id: string; encrypted_refresh_token: string; status: AccountStatus }>
    >`
      SELECT id, encrypted_refresh_token, status
      FROM drive_accounts
      WHERE id = ${accountId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1;
    `;

    if (!account) {
      throw new NotFoundError('Drive account');
    }

    let quota;
    try {
      quota = await GoogleDriveService.fetchStorageQuota(account.encrypted_refresh_token);
    } catch (err) {
      if (isTokenRevokedError(err)) {
        await this.markTokenExpired(userId, accountId);
        throw new AppError(401, 'TOKEN_EXPIRED', 'Google Drive OAuth token has expired or been revoked. Please reconnect the account.');
      }
      throw err;
    }

    // Update account with fresh quota
    const [updated] = await prisma.$queryRaw<
      Array<{
        id: string;
        google_email: string;
        status: AccountStatus;
        quota_limit_bytes: string;
        quota_used_bytes: string;
        reserved_bytes: string;
        quota_available_bytes: string;
        quota_last_synced_at: Date;
        connected_at: Date;
        last_verified_at: Date;
      }>
    >`
      UPDATE drive_accounts
      SET
        quota_limit_bytes = ${quota.quotaLimitBytes},
        quota_used_bytes = ${quota.quotaUsedBytes},
        quota_last_synced_at = NOW(),
        last_verified_at = NOW(),
        updated_at = NOW()
      WHERE id = ${accountId}::uuid
      RETURNING
        id,
        google_email,
        status,
        quota_limit_bytes::text,
        quota_used_bytes::text,
        reserved_bytes::text,
        GREATEST(0::bigint, quota_limit_bytes - quota_used_bytes - reserved_bytes)::text AS quota_available_bytes,
        quota_last_synced_at,
        connected_at,
        last_verified_at;
    `;

    // Record snapshot
    await prisma.$executeRaw`
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
        ${accountId}::uuid,
        ${quota.quotaLimitBytes},
        ${quota.quotaUsedBytes},
        ${quota.usageInDrive},
        ${quota.usageInTrash},
        (SELECT COUNT(*)::int FROM files WHERE drive_account_id = ${accountId}::uuid AND is_deleted = FALSE),
        NOW()
      );
    `;

    return {
      id: updated!.id,
      googleEmail: updated!.google_email,
      status: updated!.status,
      quotaLimitBytes: updated!.quota_limit_bytes,
      quotaUsedBytes: updated!.quota_used_bytes,
      quotaAvailableBytes: updated!.quota_available_bytes,
      reservedBytes: updated!.reserved_bytes,
      quotaLastSyncedAt: updated!.quota_last_synced_at.toISOString(),
      connectedAt: updated!.connected_at.toISOString(),
      lastVerifiedAt: updated!.last_verified_at.toISOString(),
    };
  }

  /**
   * Disconnects an account (soft disconnect).
   */
  static async disconnectAccount(
    userId: string,
    accountId: string,
  ): Promise<{ message: string; activeFilesCount: number }> {
    const [account] = await prisma.$queryRaw<Array<{ id: string; google_email: string }>>`
      SELECT id, google_email
      FROM drive_accounts
      WHERE id = ${accountId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1;
    `;

    if (!account) {
      throw new NotFoundError('Drive account');
    }

    // Check active files
    const [files] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM files
      WHERE drive_account_id = ${accountId}::uuid AND is_deleted = FALSE;
    `;

    const activeFilesCount = files?.count ?? 0;

    await prisma.$executeRaw`
      UPDATE drive_accounts
      SET
        status = 'DISCONNECTED'::"AccountStatus",
        disconnected_at = NOW(),
        updated_at = NOW()
      WHERE id = ${accountId}::uuid;
    `;

    await prisma.$executeRaw`
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
        ${userId}::uuid,
        'ACCOUNT_DISCONNECTED',
        'DRIVE_ACCOUNT',
        ${accountId}::uuid,
        ${JSON.stringify({ googleEmail: account.google_email, activeFilesCount })}::json,
        NOW()
      );
    `;

    logger.info({ accountId, userId }, 'Drive account disconnected');

    return {
      message: 'Account disconnected successfully',
      activeFilesCount,
    };
  }
}
