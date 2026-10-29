// =============================================================================
// UCSS API — Upload Pipeline (shared by REST multipart and WebDAV PUT)
// =============================================================================
// reserve bytes → stream temp file to Drive (hashing on the fly) → commit.
// Any failure releases the reservation and removes an orphaned Drive file.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline, Transform } from 'node:stream';
import { prisma } from '@ucss/database';
import { AllocationService } from './allocation.service.js';
import { AccountsService } from './accounts.service.js';
import { GoogleDriveService, isTokenRevokedError } from './google-drive.service.js';
import { AppError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface StoreFileInput {
  userId: string;
  filePath: string;
  sizeBytes: bigint;
  originalFilename: string;
  displayFilename?: string;
  mimeType: string;
  /** Pin to one account; ignored when `reservation` is supplied. */
  driveAccountId?: string;
  /** Result of a prior POST /api/files/allocate. */
  reservation?: { fileId: string; uploadOperationId: string };
}

export class UploadService {
  /** Uploads a local file to the best Drive account and returns the new file id. */
  static async storeFromDisk(input: StoreFileInput): Promise<string> {
    const { userId, sizeBytes } = input;
    let fileId: string;
    let uploadOperationId: string;
    let driveAccountId: string;
    let reserved = sizeBytes;

    if (input.reservation) {
      const [row] = await prisma.$queryRaw<Array<{ drive_account_id: string; size_bytes: string }>>`
        SELECT f.drive_account_id, f.size_bytes::text
        FROM files f
        JOIN upload_operations uo ON uo.file_id = f.id
        WHERE f.id = ${input.reservation.fileId}::uuid
          AND uo.id = ${input.reservation.uploadOperationId}::uuid
          AND f.user_id = ${userId}::uuid
          AND f.upload_status = 'PENDING'::"UploadStatus"
        LIMIT 1;
      `;
      if (!row) throw new NotFoundError('Pending file reservation not found or expired');
      ({ fileId, uploadOperationId } = {
        fileId: input.reservation.fileId,
        uploadOperationId: input.reservation.uploadOperationId,
      });
      driveAccountId = row.drive_account_id;
      reserved = BigInt(row.size_bytes);
    } else {
      const alloc = await AllocationService.allocateStorage({
        userId,
        originalFilename: input.originalFilename,
        displayFilename: input.displayFilename,
        fileSizeBytes: sizeBytes,
        mimeType: input.mimeType,
        ...(input.driveAccountId ? { driveAccountId: input.driveAccountId } : {}),
      });
      ({ fileId, uploadOperationId, driveAccountId } = alloc);
    }

    let driveFileId: string | undefined;
    let refreshToken: string | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      const [account] = await prisma.$queryRaw<Array<{ encrypted_refresh_token: string }>>`
        SELECT encrypted_refresh_token FROM drive_accounts WHERE id = ${driveAccountId}::uuid LIMIT 1;
      `;
      if (!account) throw new NotFoundError('Target drive account');
      refreshToken = account.encrypted_refresh_token;

      // A reservation sized by the client must cover what was actually sent.
      if (sizeBytes > reserved) throw new AppError(413, 'SIZE_EXCEEDS_RESERVATION', 'Uploaded file is larger than the size reserved for it');

      await AllocationService.markUploading(fileId, uploadOperationId);
      // Keep updated_at fresh so the reconciler does not abort a long but healthy upload.
      heartbeat = setInterval(() => {
        prisma.$executeRaw`UPDATE files SET updated_at = NOW() WHERE id = ${fileId}::uuid AND upload_status = 'UPLOADING'::"UploadStatus";`.catch(() => undefined);
      }, 5 * 60_000);

      // Fresh stream + hash per attempt so a retried upload still yields a correct checksum.
      let hash = crypto.createHash('sha256');
      const body = () => {
        hash = crypto.createHash('sha256');
        const current = hash;
        const hasher = new Transform({
          transform(chunk, _enc, cb) {
            current.update(chunk);
            cb(null, chunk);
          },
        });
        return pipeline(fs.createReadStream(input.filePath), hasher, () => undefined);
      };

      const startedAt = Date.now();
      ({ driveFileId } = await GoogleDriveService.uploadFile({
        encryptedRefreshToken: refreshToken,
        filename: input.originalFilename,
        mimeType: input.mimeType,
        body,
      }));

      await AllocationService.commitUploadSuccess({
        fileId,
        uploadOperationId,
        driveAccountId,
        fileSizeBytes: sizeBytes,
        reservedBytesToRelease: reserved,
        googleDriveFileId: driveFileId,
        checksumSha256: hash.digest('hex'),
        durationMs: Date.now() - startedAt,
        userId,
      });
      return fileId;
    } catch (error) {
      if (driveFileId && refreshToken) await GoogleDriveService.deleteFile(refreshToken, driveFileId);
      if (isTokenRevokedError(error)) await AccountsService.markTokenExpired(userId, driveAccountId);
      try {
        await AllocationService.releaseReservation({
          fileId,
          uploadOperationId,
          driveAccountId,
          reservedBytesToRelease: reserved,
          errorMessage: error instanceof Error ? error.message : 'Upload failed',
        });
      } catch (releaseError) {
        logger.error({ releaseError, fileId }, 'Failed to release reservation; reconciler will recover it');
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }
}
