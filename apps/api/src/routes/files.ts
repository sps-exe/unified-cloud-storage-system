// =============================================================================
// UCSS API — Files Router
// =============================================================================
// Complete REST endpoints for file upload, quota-aware storage allocation,
// paginated browsing, metadata retrieval, streaming download, renaming, and
// soft deletion.
//
// RAW SQL USAGE:
// Backed by AllocationService and FilesService using PostgreSQL CTEs, advisory
// locks, window functions, and single-pass queries.
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@ucss/database';
import { requireAuth, validateBody, validateQuery } from '../middleware/index.js';
import { AllocationService } from '../services/allocation.service.js';
import { FilesService } from '../services/files.service.js';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { AppError, ValidationError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const filesRouter = Router();

// ─── Multer Configuration ───────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max single file upload
});

function handleMultipart(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'FILE_TOO_LARGE', 'File size exceeds maximum allowed 100 MB limit'));
      }
      return next(new AppError(400, 'MULTIPART_ERROR', err.message));
    }
    next();
  });
}

// ─── Validation Schemas ─────────────────────────────────────────────────────

const initiateUploadSchema = z.object({
  originalFilename: z.string().min(1, 'Original filename is required').max(255),
  displayFilename: z.string().max(255).optional(),
  fileSizeBytes: z.union([z.string(), z.number()]).transform((val, ctx) => {
    try {
      const b = BigInt(val);
      if (b <= BigInt(0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'File size must be greater than 0' });
        return z.NEVER;
      }
      return b;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid file size integer' });
      return z.NEVER;
    }
  }),
  mimeType: z.string().optional(),
  driveAccountId: z.string().uuid().optional(),
});

const listFilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  mimeType: z.string().optional(),
  driveAccountId: z.string().uuid().optional(),
  sortBy: z.enum(['name', 'size', 'createdAt', 'updatedAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional().default('desc'),
});

const renameFileSchema = z.object({
  displayFilename: z.string().min(1, 'Display filename cannot be empty').max(255),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/files/allocate (and /initiate-upload)
 * Pre-flights storage reservation on the optimal Drive account.
 */
async function handleAllocate(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { originalFilename, displayFilename, fileSizeBytes, mimeType, driveAccountId } = req.body;

    const allocation = await AllocationService.allocateStorage({
      userId,
      originalFilename,
      displayFilename,
      fileSizeBytes,
      mimeType,
      driveAccountId,
    });

    res.status(201).json({
      ok: true,
      data: {
        fileId: allocation.fileId,
        uploadOperationId: allocation.uploadOperationId,
        driveAccountId: allocation.driveAccountId,
        googleEmail: allocation.googleEmail,
        fileSizeBytes: allocation.fileSizeBytes.toString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

filesRouter.post('/allocate', requireAuth, validateBody(initiateUploadSchema), handleAllocate);
filesRouter.post('/initiate-upload', requireAuth, validateBody(initiateUploadSchema), handleAllocate);

/**
 * POST /api/files/upload
 * Full multipart upload endpoint. Handles automatic allocation if not pre-allocated,
 * streams bytes to target Google Drive account, records SHA-256 checksum, and atomically
 * commits quota usage.
 */
filesRouter.post('/upload', requireAuth, handleMultipart, async (req: Request, res: Response, next: NextFunction) => {
  const file = req.file;
  if (!file) {
    return next(new ValidationError('Missing file payload in "file" form field'));
  }

  const userId = req.user!.id;
  const fileSizeBytes = BigInt(file.size);
  let fileId = req.body.fileId as string | undefined;
  let uploadOperationId = req.body.uploadOperationId as string | undefined;
  let driveAccountId: string;
  let reservedBytesToRelease = fileSizeBytes;

  try {
    if (fileId && uploadOperationId) {
      // 1. Verify pre-flight reservation
      const [existingFile] = await prisma.$queryRaw<Array<{ id: string; drive_account_id: string; size_bytes: string }>>`
        SELECT id, drive_account_id, size_bytes::text
        FROM files
        WHERE id = ${fileId}::uuid AND user_id = ${userId}::uuid AND upload_status = 'PENDING'::"UploadStatus"
        LIMIT 1;
      `;
      if (!existingFile) {
        throw new NotFoundError('Pending file reservation not found or expired');
      }
      driveAccountId = existingFile.drive_account_id;
      reservedBytesToRelease = BigInt(existingFile.size_bytes);
    } else {
      // 2. Perform on-the-fly allocation
      const displayFilename = req.body.displayFilename || file.originalname;
      const requestedDriveAccountId = req.body.driveAccountId as string | undefined;
      const alloc = await AllocationService.allocateStorage({
        userId,
        originalFilename: file.originalname,
        displayFilename,
        fileSizeBytes,
        mimeType: file.mimetype,
        ...(requestedDriveAccountId ? { driveAccountId: requestedDriveAccountId } : {}),
      });
      fileId = alloc.fileId;
      uploadOperationId = alloc.uploadOperationId;
      driveAccountId = alloc.driveAccountId;
      reservedBytesToRelease = fileSizeBytes;
    }

    // 3. Compute SHA-256 hash
    const checksumSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 4. Retrieve target Google Drive account credentials
    const [account] = await prisma.$queryRaw<Array<{ encrypted_refresh_token: string }>>`
      SELECT encrypted_refresh_token
      FROM drive_accounts
      WHERE id = ${driveAccountId}::uuid
      LIMIT 1;
    `;

    if (!account) {
      throw new NotFoundError('Target drive account');
    }

    // 5. Stream upload to Google Drive
    const startTime = Date.now();
    let googleDriveFileId: string | undefined;

    try {
      const uploadRes = await GoogleDriveService.uploadFile({
        encryptedRefreshToken: account.encrypted_refresh_token,
        filename: file.originalname,
        mimeType: file.mimetype,
        body: file.buffer,
      });
      googleDriveFileId = uploadRes.driveFileId;

      // 6. Commit successful upload
      const durationMs = Date.now() - startTime;
      await AllocationService.commitUploadSuccess({
        fileId: fileId!,
        uploadOperationId: uploadOperationId!,
        driveAccountId,
        fileSizeBytes,
        reservedBytesToRelease,
        googleDriveFileId,
        checksumSha256,
        durationMs,
        userId,
      });
    } catch (uploadError) {
      // If file was created on Drive before commit failed, perform best-effort cleanup
      if (googleDriveFileId) {
        try {
          await GoogleDriveService.deleteFile(account.encrypted_refresh_token, googleDriveFileId);
        } catch (cleanupErr) {
          logger.warn({ cleanupErr, googleDriveFileId }, 'Failed to clean up orphaned Drive file');
        }
      }

      // Release reserved bytes on failure
      await AllocationService.releaseReservation({
        fileId: fileId!,
        uploadOperationId: uploadOperationId!,
        driveAccountId,
        reservedBytesToRelease,
        errorMessage: uploadError instanceof Error ? uploadError.message : 'Upload or commit failed',
      });
      throw uploadError;
    }

    // 7. Return created file metadata
    const completedFile = await FilesService.getFile(userId, fileId!);
    res.status(201).json({
      ok: true,
      data: completedFile,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/files
 * Browses files with search, filtering, sorting, and pagination.
 */
filesRouter.get('/', requireAuth, validateQuery(listFilesQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const query = (req as unknown as { parsedQuery: z.infer<typeof listFilesQuerySchema> }).parsedQuery;
    const cleanQuery: Record<string, unknown> = {
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortOrder: (query.sortOrder?.toLowerCase() as 'asc' | 'desc') || 'desc',
    };
    if (query.search) cleanQuery.search = query.search;
    if (query.driveAccountId) cleanQuery.driveAccountId = query.driveAccountId;
    if (query.mimeType) cleanQuery.mimeType = query.mimeType;

    const result = await FilesService.listFiles(userId, cleanQuery as any);
    res.json({
      ok: true,
      data: result.files,
      meta: result.meta,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/files/:id
 * Retrieves metadata for a single file.
 */
filesRouter.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const fileId = String(req.params.id || '');
    const file = await FilesService.getFile(userId, fileId);
    res.json({
      ok: true,
      data: file,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/files/:id/download
 * Prepares and streams file contents from Google Drive to client.
 */
filesRouter.get('/:id/download', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const fileId = String(req.params.id || '');
    const { file, encryptedRefreshToken } = await FilesService.prepareDownload(userId, fileId);

    if (!file.driveFileId) {
      throw new AppError(404, 'FILE_NOT_READY', 'File content is not ready or has no Drive reference');
    }

    const fileStream = await GoogleDriveService.downloadFileStream({
      encryptedRefreshToken,
      driveFileId: file.driveFileId,
    });

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.displayFilename)}"`,
    );
    res.setHeader('Content-Length', file.sizeBytes);
    if (file.checksumSha256) {
      res.setHeader('ETag', `"${file.checksumSha256}"`);
    }

    fileStream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/files/:id
 * Renames a file's display name and syncs rename to Google Drive.
 */
filesRouter.patch(
  '/:id',
  requireAuth,
  validateBody(renameFileSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const fileId = String(req.params.id || '');
      const updated = await FilesService.renameFile(userId, fileId, req.body.displayFilename);
      res.json({
        ok: true,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/files/:id
 * Soft deletes a file.
 */
filesRouter.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const fileId = String(req.params.id || '');
    const result = await FilesService.softDeleteFile(userId, fileId);
    res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});
