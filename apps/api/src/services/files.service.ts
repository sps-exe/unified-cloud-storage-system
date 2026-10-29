// =============================================================================
// UCSS API — Files Management Service
// =============================================================================
// Manages file metadata, paginated browsing, full-text search, soft-deletion,
// renaming, and Google Drive streaming download preparation.
//
// RAW SQL USAGE:
// Uses prisma.$queryRaw for files.sql (window functions, dynamic CASE sorting,
// ILIKE search, and MIME categorization).
// =============================================================================

import { prisma } from '@ucss/database';
import { GoogleDriveService } from './google-drive.service.js';
import { decryptToken } from '../lib/crypto.js';
import { NotFoundError, AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { FileDto, FileListQuery, PaginationMeta, UploadStatus } from '@ucss/shared';

export interface FileListResult {
  files: FileDto[];
  meta: PaginationMeta;
}

export class FilesService {
  /**
   * Lists files for a user with dynamic sorting, filtering, and pagination
   * using a single-pass window function query.
   */
  static async listFiles(
    userId: string,
    query: FileListQuery,
  ): Promise<FileListResult> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;
    const search = query.search?.trim() || null;
    // "image/" matches the whole family, "application/pdf" is exact; comma-separated for several.
    const mimePatterns = (query.mimeType ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
      .map((m) => (m.endsWith('/') ? `${m}%` : m.replace(/\*/g, '%')));
    const mimeFilter = mimePatterns.length > 0 ? mimePatterns : null;
    const driveAccountId = query.driveAccountId?.trim() || null;
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Map frontend sort names to SQL column names
    const sortColumnMap: Record<string, string> = {
      name: 'display_filename',
      size: 'size_bytes',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };
    const sqlSortColumn = sortColumnMap[sortBy] || 'created_at';

    interface FileRow {
      id: string;
      drive_account_id: string;
      drive_account_email: string;
      original_filename: string;
      display_filename: string;
      mime_type: string;
      size_bytes: string;
      upload_status: UploadStatus;
      checksum_sha256: string | null;
      created_at: Date;
      updated_at: Date;
      total_count: string;
    }

    const rows = await prisma.$queryRaw<Array<FileRow>>`
      SELECT 
        f.id,
        f.drive_account_id,
        da.google_email AS drive_account_email,
        f.original_filename,
        f.display_filename,
        f.mime_type,
        f.size_bytes::text,
        f.upload_status,
        f.checksum_sha256,
        f.created_at,
        f.updated_at,
        COUNT(*) OVER ()::text AS total_count
      FROM files f
      JOIN drive_accounts da ON da.id = f.drive_account_id
      WHERE 
        f.user_id = ${userId}::uuid
        AND f.is_deleted = FALSE
        AND f.upload_status = 'COMPLETED'
        AND (${search}::text IS NULL OR f.display_filename ILIKE '%' || ${search} || '%')
        AND (${mimeFilter}::text[] IS NULL OR f.mime_type ILIKE ANY(${mimeFilter}::text[]))
        AND (${driveAccountId}::uuid IS NULL OR f.drive_account_id = ${driveAccountId}::uuid)
      ORDER BY 
        CASE WHEN ${sqlSortColumn} = 'display_filename' AND ${sortOrder} = 'ASC'  THEN f.display_filename END ASC,
        CASE WHEN ${sqlSortColumn} = 'display_filename' AND ${sortOrder} = 'DESC' THEN f.display_filename END DESC,
        CASE WHEN ${sqlSortColumn} = 'size_bytes'       AND ${sortOrder} = 'ASC'  THEN f.size_bytes END ASC,
        CASE WHEN ${sqlSortColumn} = 'size_bytes'       AND ${sortOrder} = 'DESC' THEN f.size_bytes END DESC,
        CASE WHEN ${sqlSortColumn} = 'created_at'       AND ${sortOrder} = 'ASC'  THEN f.created_at END ASC,
        CASE WHEN ${sqlSortColumn} = 'created_at'       AND ${sortOrder} = 'DESC' THEN f.created_at END DESC,
        CASE WHEN ${sqlSortColumn} = 'updated_at'       AND ${sortOrder} = 'ASC'  THEN f.updated_at END ASC,
        CASE WHEN ${sqlSortColumn} = 'updated_at'       AND ${sortOrder} = 'DESC' THEN f.updated_at END DESC,
        f.created_at DESC
      LIMIT ${pageSize}::int
      OFFSET ${offset}::int;
    `;

    const total = rows.length > 0 ? parseInt(rows[0]!.total_count, 10) : 0;
    const totalPages = Math.ceil(total / pageSize);

    const files: FileDto[] = rows.map((r) => ({
      id: r.id,
      driveAccountId: r.drive_account_id,
      driveAccountEmail: r.drive_account_email,
      originalFilename: r.original_filename,
      displayFilename: r.display_filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      uploadStatus: r.upload_status,
      checksumSha256: r.checksum_sha256,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));

    return {
      files,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  /**
   * Retrieves single file metadata for an authenticated user.
   */
  static async getFile(userId: string, fileId: string): Promise<FileDto> {
    interface SingleFileRow {
      id: string;
      drive_account_id: string;
      drive_account_email: string;
      original_filename: string;
      display_filename: string;
      mime_type: string;
      size_bytes: string;
      upload_status: UploadStatus;
      checksum_sha256: string | null;
      created_at: Date;
      updated_at: Date;
    }

    const [row] = await prisma.$queryRaw<Array<SingleFileRow>>`
      SELECT 
        f.id,
        f.drive_account_id,
        da.google_email AS drive_account_email,
        f.original_filename,
        f.display_filename,
        f.mime_type,
        f.size_bytes::text,
        f.upload_status,
        f.checksum_sha256,
        f.created_at,
        f.updated_at
      FROM files f
      JOIN drive_accounts da ON da.id = f.drive_account_id
      WHERE f.id = ${fileId}::uuid AND f.user_id = ${userId}::uuid AND f.is_deleted = FALSE
      LIMIT 1;
    `;

    if (!row) {
      throw new NotFoundError('File');
    }

    return {
      id: row.id,
      driveAccountId: row.drive_account_id,
      driveAccountEmail: row.drive_account_email,
      originalFilename: row.original_filename,
      displayFilename: row.display_filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      uploadStatus: row.upload_status,
      checksumSha256: row.checksum_sha256,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  /**
   * Renames a file's display name and syncs the rename to Google Drive.
   */
  static async renameFile(
    userId: string,
    fileId: string,
    newDisplayName: string,
  ): Promise<FileDto> {
    const trimmed = newDisplayName.trim();
    if (!trimmed) {
      throw new AppError(400, 'INVALID_NAME', 'Filename cannot be empty');
    }

    // 1. Fetch file + account info
    const [file] = await prisma.$queryRaw<
      Array<{
        id: string;
        drive_file_id: string | null;
        encrypted_refresh_token: string;
      }>
    >`
      SELECT f.id, f.drive_file_id, da.encrypted_refresh_token
      FROM files f
      JOIN drive_accounts da ON da.id = f.drive_account_id
      WHERE f.id = ${fileId}::uuid AND f.user_id = ${userId}::uuid AND f.is_deleted = FALSE
      LIMIT 1;
    `;

    if (!file) {
      throw new NotFoundError('File');
    }

    // 2. If connected to live Google Drive, sync rename
    if (file.drive_file_id) {
      try {
        const driveClient = GoogleDriveService.getAuthenticatedClient(file.encrypted_refresh_token);
        await driveClient.files.update({
          fileId: file.drive_file_id,
          requestBody: { name: trimmed },
        });
      } catch (error) {
        logger.warn({ error, fileId }, 'Failed to sync rename to Google Drive (updating DB only)');
      }
    }

    // 3. Update database
    await prisma.$executeRaw`
      UPDATE files
      SET display_filename = ${trimmed}, updated_at = NOW()
      WHERE id = ${fileId}::uuid;
    `;

    // 4. Audit log
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
        'FILE_RENAMED',
        'FILE',
        ${fileId}::uuid,
        ${JSON.stringify({ newDisplayName: trimmed })}::json,
        NOW()
      );
    `;

    return await this.getFile(userId, fileId);
  }

  /**
   * Deletes a file: removes the bytes from Google Drive (so the space is really freed),
   * releases the quota counter, and keeps the DB row as a soft-deleted audit record.
   */
  static async softDeleteFile(
    userId: string,
    fileId: string,
  ): Promise<{ message: string }> {
    const [file] = await prisma.$queryRaw<
      Array<{
        id: string;
        display_filename: string;
        size_bytes: string;
        drive_account_id: string;
        drive_file_id: string | null;
        upload_status: UploadStatus;
        encrypted_refresh_token: string;
      }>
    >`
      SELECT f.id, f.display_filename, f.size_bytes::text, f.drive_account_id, f.drive_file_id,
             f.upload_status::text AS upload_status, da.encrypted_refresh_token
      FROM files f
      JOIN drive_accounts da ON da.id = f.drive_account_id
      WHERE f.id = ${fileId}::uuid AND f.user_id = ${userId}::uuid AND f.is_deleted = FALSE
      LIMIT 1;
    `;

    if (!file) {
      throw new NotFoundError('File');
    }

    if (file.upload_status === 'PENDING' || file.upload_status === 'UPLOADING') {
      throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'This file is still uploading; wait for it to finish or fail before deleting it');
    }

    const hasBytes = file.upload_status === 'COMPLETED' && !!file.drive_file_id;
    const driveDeleted = hasBytes
      ? await GoogleDriveService.deleteFile(file.encrypted_refresh_token, file.drive_file_id!)
      : true;

    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE files
        SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
        WHERE id = ${fileId}::uuid;
      `,
      // Quota is re-synced from Google periodically; this keeps it right in between.
      prisma.$executeRaw`
        UPDATE drive_accounts
        SET quota_used_bytes = GREATEST(0::bigint, quota_used_bytes - ${hasBytes && driveDeleted ? BigInt(file.size_bytes) : 0n}::bigint),
            updated_at = NOW()
        WHERE id = ${file.drive_account_id}::uuid;
      `,
      prisma.$executeRaw`
        INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
        VALUES (
          gen_random_uuid(),
          ${userId}::uuid,
          'FILE_SOFT_DELETED',
          'FILE',
          ${fileId}::uuid,
          ${JSON.stringify({
            displayFilename: file.display_filename,
            sizeBytes: file.size_bytes,
            driveDeleted,
          })}::json,
          NOW()
        );
      `,
    ]);

    logger.info({ fileId, userId, driveDeleted }, 'File deleted');
    return {
      message: driveDeleted
        ? 'File deleted successfully'
        : 'File removed from UCSS, but Google Drive could not be reached. Delete the leftover copy from the _UCSS_ROOT_ folder in that Drive account to free the space.',
    };
  }

  /**
   * Prepares a file for streaming download by returning file metadata
   * and the Google Drive client.
   */
  static async prepareDownload(
    userId: string,
    fileId: string,
  ): Promise<{
    file: {
      id: string;
      displayFilename: string;
      mimeType: string;
      sizeBytes: string;
      driveFileId: string | null;
      checksumSha256: string | null;
    };
    encryptedRefreshToken: string;
  }> {
    interface DownloadRow {
      id: string;
      display_filename: string;
      mime_type: string;
      size_bytes: string;
      drive_file_id: string | null;
      checksum_sha256: string | null;
      encrypted_refresh_token: string;
    }

    const [row] = await prisma.$queryRaw<Array<DownloadRow>>`
      SELECT 
        f.id,
        f.display_filename,
        f.mime_type,
        f.size_bytes::text,
        f.drive_file_id,
        f.checksum_sha256,
        da.encrypted_refresh_token
      FROM files f
      JOIN drive_accounts da ON da.id = f.drive_account_id
      WHERE f.id = ${fileId}::uuid AND f.user_id = ${userId}::uuid AND f.is_deleted = FALSE
      LIMIT 1;
    `;

    if (!row) {
      throw new NotFoundError('File');
    }

    return {
      file: {
        id: row.id,
        displayFilename: row.display_filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        driveFileId: row.drive_file_id,
        checksumSha256: row.checksum_sha256,
      },
      encryptedRefreshToken: row.encrypted_refresh_token,
    };
  }
}
