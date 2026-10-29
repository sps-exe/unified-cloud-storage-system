// =============================================================================
// UCSS API — Storage Allocation Engine
// =============================================================================
// Implements intelligent account selection, atomic byte reservation, and
// release lifecycles using PostgreSQL transaction-level advisory locks.
//
// RAW SQL USAGE:
// Uses prisma.$queryRaw for pg_advisory_xact_lock, atomic CTEs, and BigInt math.
// =============================================================================

import { prisma } from '@ucss/database';
import { env } from '../lib/env.js';
import { QuotaExceededError, NotFoundError, AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface AllocationResult {
  fileId: string;
  uploadOperationId: string;
  driveAccountId: string;
  googleEmail: string;
  fileSizeBytes: bigint;
}

export class AllocationService {
  /**
   * Allocates storage on the best available Google Drive account for a file upload.
   *
   * ATOMICITY GUARANTEE:
   * 1. Evaluates eligible active accounts sorted by most available space descending.
   * 2. Acquires pg_advisory_xact_lock on the selected account's ID hash.
   * 3. Re-verifies capacity inside the transaction lock.
   * 4. Increments reserved_bytes atomically.
   * 5. Creates File (PENDING) and UploadOperation (PENDING) records.
   */
  static async allocateStorage(input: {
    userId: string;
    originalFilename: string;
    displayFilename?: string;
    fileSizeBytes: bigint;
    mimeType?: string;
    driveAccountId?: string;
  }): Promise<AllocationResult> {
    const { userId, originalFilename, fileSizeBytes, driveAccountId } = input;
    const displayFilename = input.displayFilename?.trim() || originalFilename;
    const mimeType = input.mimeType || 'application/octet-stream';
    const safetyMargin = env.QUOTA_SAFETY_MARGIN_BYTES;
    const marginMb = Number(safetyMargin / BigInt(1024 * 1024));

    return await prisma.$transaction(async (tx) => {
      // 1. Select the account with the most available headroom that can fit this file, or the requested specific account
      interface EligibleAccount {
        id: string;
        google_email: string;
        quota_limit_bytes: string;
        quota_used_bytes: string;
        reserved_bytes: string;
        effective_available: string;
      }

      let bestAccount: EligibleAccount | undefined;

      if (driveAccountId) {
        const specific = await tx.$queryRaw<Array<EligibleAccount>>`
          SELECT 
            da.id,
            da.google_email,
            da.quota_limit_bytes::text,
            da.quota_used_bytes::text,
            da.reserved_bytes::text,
            (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes - ${safetyMargin}::bigint)::text AS effective_available
          FROM drive_accounts da
          WHERE 
            da.id = ${driveAccountId}::uuid
            AND da.user_id = ${userId}::uuid
            AND da.status = 'ACTIVE'
            AND (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes - ${safetyMargin}::bigint) >= ${fileSizeBytes}::bigint
          LIMIT 1
          FOR UPDATE;
        `;
        bestAccount = specific[0];
        if (!bestAccount) {
          throw new QuotaExceededError(
            `The selected Google Drive account does not have sufficient available storage for this file (a ${marginMb} MB safety margin is enforced)`,
          );
        }
      } else {
        const eligible = await tx.$queryRaw<Array<EligibleAccount>>`
          SELECT 
            da.id,
            da.google_email,
            da.quota_limit_bytes::text,
            da.quota_used_bytes::text,
            da.reserved_bytes::text,
            (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes - ${safetyMargin}::bigint)::text AS effective_available
          FROM drive_accounts da
          WHERE 
            da.user_id = ${userId}::uuid
            AND da.status = 'ACTIVE'
            AND (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes - ${safetyMargin}::bigint) >= ${fileSizeBytes}::bigint
          ORDER BY 
            (da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes) DESC,
            da.quota_last_synced_at ASC NULLS LAST
          LIMIT 1
          FOR UPDATE;
        `;
        bestAccount = eligible[0];
        if (!bestAccount) {
          const [{ n } = { n: 0 }] = await tx.$queryRaw<Array<{ n: number }>>`
            SELECT COUNT(*)::int AS n FROM drive_accounts WHERE user_id = ${userId}::uuid AND status = 'ACTIVE';
          `;
          if (n === 0) {
            throw new AppError(409, 'NO_DRIVE_ACCOUNT', 'No Google Drive account is connected yet. Open Accounts and connect one first.');
          }
          logger.warn(
            { userId, fileSize: fileSizeBytes.toString() },
            'Storage allocation failed: insufficient capacity across all connected accounts',
          );
          throw new QuotaExceededError(
            `No connected Google Drive account has sufficient storage for this file (a ${marginMb} MB safety margin is enforced)`,
          );
        }
      }

      // 2. Acquire transaction-level advisory lock on this account ID hash
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext('alloc_' || ${bestAccount.id}::text));
      `;

      // 3. Atomically increment reserved_bytes on the drive account
      const [updatedAccount] = await tx.$queryRaw<Array<{ id: string; reserved_bytes: string }>>`
        UPDATE drive_accounts
        SET 
          reserved_bytes = reserved_bytes + ${fileSizeBytes}::bigint,
          updated_at = NOW()
        WHERE id = ${bestAccount.id}::uuid
        RETURNING id, reserved_bytes::text;
      `;

      if (!updatedAccount) {
        throw new AppError(500, 'ALLOCATION_UPDATE_FAILED', 'Failed to reserve bytes on target account');
      }

      // 4. Create the File record in PENDING state
      const [file] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO files (
          id,
          user_id,
          drive_account_id,
          original_filename,
          display_filename,
          mime_type,
          size_bytes,
          upload_status,
          is_deleted,
          created_at,
          updated_at
        )
        VALUES (
          gen_random_uuid(),
          ${userId}::uuid,
          ${bestAccount.id}::uuid,
          ${originalFilename},
          ${displayFilename},
          ${mimeType},
          ${fileSizeBytes}::bigint,
          'PENDING'::"UploadStatus",
          FALSE,
          NOW(),
          NOW()
        )
        RETURNING id;
      `;

      if (!file) {
        throw new AppError(500, 'FILE_RECORD_FAILED', 'Failed to create file tracking record');
      }

      // 5. Create the UploadOperation record in PENDING state
      const [operation] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO upload_operations (
          id,
          file_id,
          drive_account_id,
          status,
          retry_count,
          max_retries,
          started_at,
          updated_at
        )
        VALUES (
          gen_random_uuid(),
          ${file.id}::uuid,
          ${bestAccount.id}::uuid,
          'PENDING'::"UploadStatus",
          0,
          3,
          NOW(),
          NOW()
        )
        RETURNING id;
      `;

      logger.info(
        {
          fileId: file.id,
          uploadOpId: operation!.id,
          accountId: bestAccount.id,
          googleEmail: bestAccount.google_email,
          bytes: fileSizeBytes.toString(),
        },
        'Storage allocated and bytes reserved',
      );

      return {
        fileId: file.id,
        uploadOperationId: operation!.id,
        driveAccountId: bestAccount.id,
        googleEmail: bestAccount.google_email,
        fileSizeBytes,
      };
    });
  }

  /**
   * Flags the file/operation as UPLOADING. Without this a long upload stays PENDING and the
   * reconciler (5 min PENDING threshold) aborts it while bytes are still streaming.
   */
  static async markUploading(fileId: string, uploadOperationId: string): Promise<void> {
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE files SET upload_status = 'UPLOADING'::"UploadStatus", updated_at = NOW() WHERE id = ${fileId}::uuid AND upload_status = 'PENDING'::"UploadStatus";`,
      prisma.$executeRaw`UPDATE upload_operations SET status = 'UPLOADING'::"UploadStatus", updated_at = NOW() WHERE id = ${uploadOperationId}::uuid AND status = 'PENDING'::"UploadStatus";`,
    ]);
  }

  /**
   * Commits successful upload completion:
   *   - Shifts reserved_bytes -> quota_used_bytes
   *   - Updates File to COMPLETED with googleDriveFileId, final verified size, & checksum
   *   - Updates UploadOperation to COMPLETED
   */
  static async commitUploadSuccess(params: {
    fileId: string;
    uploadOperationId: string;
    driveAccountId: string;
    fileSizeBytes: bigint;
    reservedBytesToRelease?: bigint;
    googleDriveFileId: string;
    checksumSha256: string;
    durationMs: number;
    userId: string;
  }): Promise<void> {
    const {
      fileId,
      uploadOperationId,
      driveAccountId,
      fileSizeBytes,
      reservedBytesToRelease = params.fileSizeBytes,
      googleDriveFileId,
      checksumSha256,
      durationMs,
      userId,
    } = params;

    await prisma.$transaction(async (tx) => {
      // 1. Update File record with final confirmed size
      await tx.$executeRaw`
        UPDATE files
        SET 
          upload_status = 'COMPLETED'::"UploadStatus",
          size_bytes = ${fileSizeBytes}::bigint,
          drive_file_id = ${googleDriveFileId},
          checksum_sha256 = ${checksumSha256},
          updated_at = NOW()
        WHERE id = ${fileId}::uuid;
      `;

      // 2. Update UploadOperation record
      await tx.$executeRaw`
        UPDATE upload_operations
        SET 
          status = 'COMPLETED'::"UploadStatus",
          completed_at = NOW(),
          duration_ms = ${durationMs},
          updated_at = NOW()
        WHERE id = ${uploadOperationId}::uuid;
      `;

      // 3. Shift bytes: decrement reserved_bytes, increment quota_used_bytes
      await tx.$executeRaw`
        UPDATE drive_accounts
        SET 
          reserved_bytes = GREATEST(0::bigint, reserved_bytes - ${reservedBytesToRelease}::bigint),
          quota_used_bytes = quota_used_bytes + ${fileSizeBytes}::bigint,
          updated_at = NOW()
        WHERE id = ${driveAccountId}::uuid;
      `;

      // 4. Record audit log
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
          ${userId}::uuid,
          'FILE_UPLOADED',
          'FILE',
          ${fileId}::uuid,
          ${JSON.stringify({
            googleDriveFileId,
            sizeBytes: fileSizeBytes.toString(),
            durationMs,
          })}::json,
          NOW()
        );
      `;
    });

    logger.info({ fileId, googleDriveFileId }, 'Upload committed successfully');
  }

  /**
   * Releases byte reservation on upload failure or cancellation.
   */
  static async releaseReservation(params: {
    fileId: string;
    uploadOperationId: string;
    driveAccountId: string;
    reservedBytesToRelease: bigint;
    errorMessage: string;
    errorCode?: string;
  }): Promise<void> {
    const {
      fileId,
      uploadOperationId,
      driveAccountId,
      reservedBytesToRelease,
      errorMessage,
      errorCode,
    } = params;

    await prisma.$transaction(async (tx) => {
      // 1. Update File status to FAILED
      await tx.$executeRaw`
        UPDATE files
        SET 
          upload_status = 'FAILED'::"UploadStatus",
          updated_at = NOW()
        WHERE id = ${fileId}::uuid;
      `;

      // 2. Update UploadOperation
      await tx.$executeRaw`
        UPDATE upload_operations
        SET 
          status = 'FAILED'::"UploadStatus",
          error_message = ${errorMessage},
          error_code = ${errorCode || 'UPLOAD_FAILED'},
          updated_at = NOW()
        WHERE id = ${uploadOperationId}::uuid;
      `;

      // 3. Release reserved bytes
      await tx.$executeRaw`
        UPDATE drive_accounts
        SET 
          reserved_bytes = GREATEST(0::bigint, reserved_bytes - ${reservedBytesToRelease}::bigint),
          updated_at = NOW()
        WHERE id = ${driveAccountId}::uuid;
      `;
    });

    logger.warn({ fileId, error: errorMessage }, 'Upload failed — reservation released');
  }
}
