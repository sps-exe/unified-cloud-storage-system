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
import fs from 'node:fs';
import { requireAuth, validateBody, validateQuery } from '../middleware/index.js';
import { AllocationService } from '../services/allocation.service.js';
import { AccountsService } from '../services/accounts.service.js';
import { FilesService } from '../services/files.service.js';
import { UploadService } from '../services/upload.service.js';
import { GoogleDriveService, isTokenRevokedError } from '../services/google-drive.service.js';
import { AppError, ValidationError, NotFoundError } from '../lib/errors.js';
import { env } from '../lib/env.js';
import { uploadTmpDir } from '../lib/tmp.js';
import { contentDisposition, parseRange, pipeToResponse } from '../lib/http.js';

export const filesRouter = Router();

// ─── Multer Configuration ───────────────────────────────────────────────────
// Spooled to disk (not RAM) so large files don't balloon the Node heap.
const upload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, uploadTmpDir()) }),
  limits: { fileSize: env.MAX_UPLOAD_BYTES },
});

function handleMultipart(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'FILE_TOO_LARGE', `File exceeds the ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 ** 2)} MB upload limit of this server`));
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

// Reject malformed ids up front; otherwise the ::uuid cast in SQL surfaces as a 500.
filesRouter.param('id', (_req, _res, next, id: string) => {
  next(z.string().uuid().safeParse(id).success ? undefined : new NotFoundError('File'));
});

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
  try {
    if (!file) throw new ValidationError('Missing file payload in "file" form field');

    const userId = req.user!.id;
    // multer decodes multipart filenames as latin1; recover the UTF-8 name.
    const originalFilename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const { fileId, uploadOperationId, displayFilename, driveAccountId } = req.body as Record<string, string | undefined>;
    const uuid = z.string().uuid();

    const newFileId = await UploadService.storeFromDisk({
      userId,
      filePath: file.path,
      sizeBytes: BigInt(file.size),
      originalFilename,
      displayFilename: displayFilename || originalFilename,
      mimeType: file.mimetype,
      ...(fileId && uploadOperationId
        ? { reservation: { fileId: uuid.parse(fileId), uploadOperationId: uuid.parse(uploadOperationId) } }
        : driveAccountId
          ? { driveAccountId: uuid.parse(driveAccountId) }
          : {}),
    });

    res.status(201).json({ ok: true, data: await FilesService.getFile(userId, newFileId) });
  } catch (err) {
    next(err instanceof z.ZodError ? new ValidationError('Invalid id in upload form') : err);
  } finally {
    if (file) fs.rm(file.path, { force: true }, () => undefined);
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
 * Handles streaming file contents from Google Drive to client.
 * Supports HTTP 206 Partial Content (Range requests) for seeking in videos/audio
 * and inline preview for images, documents, and code.
 */
async function handleFileStream(req: Request, res: Response, next: NextFunction, forceInline = false) {
  try {
    const userId = req.user!.id;
    const fileId = String(req.params.id || '');
    const { file, encryptedRefreshToken } = await FilesService.prepareDownload(userId, fileId);

    if (!file.driveFileId) {
      throw new AppError(404, 'FILE_NOT_READY', 'File content is not ready or has no Drive reference');
    }

    const totalSize = BigInt(file.sizeBytes);
    const range = parseRange(req.headers.range, totalSize);
    if (range === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
      return;
    }

    // Open the Drive stream first: if it fails, the error response must not inherit file headers.
    const fileStream = await GoogleDriveService.downloadFileStream({
      encryptedRefreshToken,
      driveFileId: file.driveFileId,
      ...(range ? { range: `bytes=${range.start}-${range.end}` } : {}),
    }).catch(async (err) => {
      if (isTokenRevokedError(err)) {
        const { driveAccountId } = await FilesService.getFile(userId, fileId);
        await AccountsService.markTokenExpired(userId, driveAccountId);
      }
      throw err;
    });

    const isInline = forceInline || req.query.inline === 'true';
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(isInline ? 'inline' : 'attachment', file.displayFilename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (file.checksumSha256) res.setHeader('ETag', `"${file.checksumSha256}"`);

    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
      res.setHeader('Content-Length', (range.end - range.start + 1n).toString());
    } else {
      res.status(200);
      res.setHeader('Content-Length', totalSize.toString());
    }
    pipeToResponse(fileStream, res);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/files/:id/download
 * Prepares and streams file contents as an attachment.
 */
filesRouter.get('/:id/download', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  handleFileStream(req, res, next, false);
});

/**
 * GET /api/files/:id/stream
 * Prepares and streams file contents inline with HTTP Range support for video/audio/PDF.
 */
filesRouter.get('/:id/stream', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  handleFileStream(req, res, next, true);
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
