// =============================================================================
// UCSS API — Native WebDAV Server Router (RFC 4918)
// =============================================================================
// Enables native network drive mounting in macOS Finder (Cmd+K -> http://localhost:4000/webdav),
// Windows File Explorer ("Map network drive"), Cyberduck, and Linux file managers.
//
// Supported WebDAV Methods:
//   - OPTIONS: WebDAV capability discovery (Class 1 & 2 compliant)
//   - PROPFIND: Directory & file metadata listing with Depth 0 / 1
//   - GET / HEAD: Stream reading with HTTP 206 Range seeking
//   - PUT: File creation / upload from native desktop drag-and-drop
//   - DELETE: Soft deletion (moves to Trash)
//   - MOVE: Rename / move
//   - LOCK / UNLOCK: Compatibility for macOS Finder and Windows Explorer locking
//   - PROPPATCH / MKCOL: Property manipulation and collection stubs
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@ucss/database';
import { AuthService } from '../services/auth.service.js';
import { AllocationService } from '../services/allocation.service.js';
import { FilesService } from '../services/files.service.js';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export const webdavRouter = Router();

// ─── Helper: XML Escaping ───────────────────────────────────────────────────

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── WebDAV Authentication Middleware ───────────────────────────────────────

async function authenticateWebDAV(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="UCSS Cloud Storage Network Drive"');
    res.status(401).send('Authentication required');
    return;
  }

  try {
    // 1. Check for Bearer token
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string; email: string };
      req.user = { id: payload.sub, email: payload.email };
      return next();
    }

    // 2. Check for Basic Auth (standard WebDAV client auth)
    if (authHeader.startsWith('Basic ')) {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIdx = credentials.indexOf(':');
      if (colonIdx === -1) {
        res.setHeader('WWW-Authenticate', 'Basic realm="UCSS Cloud Storage Network Drive"');
        res.status(401).send('Invalid credentials format');
        return;
      }

      const email = credentials.substring(0, colonIdx);
      const password = credentials.substring(colonIdx + 1);

      const loginResult = await AuthService.login(email, password, req.ip);
      req.user = { id: loginResult.user.id, email: loginResult.user.email };
      return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="UCSS Cloud Storage Network Drive"');
    res.status(401).send('Unsupported authentication method');
  } catch (error) {
    logger.warn({ error, ip: req.ip }, 'WebDAV authentication failed');
    res.setHeader('WWW-Authenticate', 'Basic realm="UCSS Cloud Storage Network Drive"');
    res.status(401).send('Authentication failed');
  }
}

// Apply authentication to all WebDAV operations
webdavRouter.use(authenticateWebDAV);

// ─── 1. OPTIONS Handler (Class 1 & 2 WebDAV Server) ─────────────────────────

webdavRouter.options('*', (_req: Request, res: Response) => {
  res.setHeader('DAV', '1, 2');
  res.setHeader('MS-Author-Via', 'DAV');
  res.setHeader(
    'Allow',
    'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK',
  );
  res.status(200).end();
});

// ─── 2. PROPFIND Handler (Directory & File Metadata) ────────────────────────

webdavRouter.all('*', async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'PROPFIND') {
    return next();
  }

  try {
    const userId = req.user!.id;
    const depth = req.headers['depth'] || '1';
    const rawPath = decodeURIComponent(req.path.replace(/^\/+/, ''));

    // If requesting root folder
    if (!rawPath || rawPath === '') {
      let xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>UCSS Cloud Storage</D:displayname>
        <D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;

      // If depth is not 0, list all active completed files
      if (depth !== '0') {
        const files = await prisma.$queryRaw<
          Array<{
            id: string;
            display_filename: string;
            size_bytes: string;
            mime_type: string;
            created_at: Date;
            updated_at: Date;
            checksum_sha256: string | null;
          }>
        >`
          SELECT id, display_filename, size_bytes::text, mime_type, created_at, updated_at, checksum_sha256
          FROM files
          WHERE user_id = ${userId}::uuid
            AND is_deleted = false
            AND upload_status = 'COMPLETED'::"UploadStatus"
          ORDER BY display_filename ASC;
        `;

        for (const file of files) {
          xml += `
  <D:response>
    <D:href>/webdav/${encodeURIComponent(file.display_filename)}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype/>
        <D:displayname>${escapeXml(file.display_filename)}</D:displayname>
        <D:getcontentlength>${file.size_bytes}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(file.mime_type || 'application/octet-stream')}</D:getcontenttype>
        <D:getlastmodified>${new Date(file.updated_at).toUTCString()}</D:getlastmodified>
        <D:creationdate>${new Date(file.created_at).toISOString()}</D:creationdate>
        <D:getetag>"${file.checksum_sha256 || file.id}"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
        }
      }

      xml += `\n</D:multistatus>`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.status(207).send(xml);
      return;
    }

    // Specific file PROPFIND
    const [file] = await prisma.$queryRaw<
      Array<{
        id: string;
        display_filename: string;
        size_bytes: string;
        mime_type: string;
        created_at: Date;
        updated_at: Date;
        checksum_sha256: string | null;
      }>
    >`
      SELECT id, display_filename, size_bytes::text, mime_type, created_at, updated_at, checksum_sha256
      FROM files
      WHERE user_id = ${userId}::uuid
        AND is_deleted = false
        AND (display_filename = ${rawPath} OR id::text = ${rawPath})
        AND upload_status = 'COMPLETED'::"UploadStatus"
      LIMIT 1;
    `;

    if (!file) {
      res.status(404).send('Not Found');
      return;
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/${encodeURIComponent(file.display_filename)}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype/>
        <D:displayname>${escapeXml(file.display_filename)}</D:displayname>
        <D:getcontentlength>${file.size_bytes}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(file.mime_type || 'application/octet-stream')}</D:getcontenttype>
        <D:getlastmodified>${new Date(file.updated_at).toUTCString()}</D:getlastmodified>
        <D:creationdate>${new Date(file.created_at).toISOString()}</D:creationdate>
        <D:getetag>"${file.checksum_sha256 || file.id}"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    logger.error({ error }, 'WebDAV PROPFIND failed');
    next(error);
  }
});

// ─── 3. GET / HEAD Handlers (Streaming with Range Support) ──────────────────

webdavRouter.get('*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const rawPath = decodeURIComponent(req.path.replace(/^\/+/, ''));

    if (!rawPath) {
      res.status(200).json({ ok: true, message: 'UCSS WebDAV Root. Use a WebDAV client to mount.' });
      return;
    }

    const [fileRecord] = await prisma.$queryRaw<
      Array<{
        id: string;
        display_filename: string;
        size_bytes: string;
        mime_type: string;
        checksum_sha256: string | null;
        drive_file_id: string | null;
        drive_account_id: string;
      }>
    >`
      SELECT id, display_filename, size_bytes::text, mime_type, checksum_sha256, drive_file_id, drive_account_id
      FROM files
      WHERE user_id = ${userId}::uuid
        AND is_deleted = false
        AND (display_filename = ${rawPath} OR id::text = ${rawPath})
        AND upload_status = 'COMPLETED'::"UploadStatus"
      LIMIT 1;
    `;

    if (!fileRecord || !fileRecord.drive_file_id) {
      res.status(404).send('File not found');
      return;
    }

    const [account] = await prisma.$queryRaw<Array<{ encrypted_refresh_token: string }>>`
      SELECT encrypted_refresh_token
      FROM drive_accounts
      WHERE id = ${fileRecord.drive_account_id}::uuid
      LIMIT 1;
    `;

    if (!account) {
      res.status(404).send('Target storage account unavailable');
      return;
    }

    const totalSize = BigInt(fileRecord.size_bytes);
    const rangeHeader = req.headers['range'];

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', fileRecord.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileRecord.display_filename)}"`);
    if (fileRecord.checksum_sha256) {
      res.setHeader('ETag', `"${fileRecord.checksum_sha256}"`);
    }

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parts[0] ? BigInt(parts[0]) : BigInt(0);
      const end = parts[1] ? BigInt(parts[1]) : totalSize - BigInt(1);

      if (start >= totalSize || end >= totalSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${totalSize}`);
        res.end();
        return;
      }

      const chunkSize = end - start + BigInt(1);
      const stream = await GoogleDriveService.downloadFileStream({
        encryptedRefreshToken: account.encrypted_refresh_token,
        driveFileId: fileRecord.drive_file_id,
        range: `bytes=${start}-${end}`,
      });

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      res.setHeader('Content-Length', chunkSize.toString());
      stream.pipe(res);
    } else {
      const stream = await GoogleDriveService.downloadFileStream({
        encryptedRefreshToken: account.encrypted_refresh_token,
        driveFileId: fileRecord.drive_file_id,
      });

      res.status(200);
      res.setHeader('Content-Length', totalSize.toString());
      stream.pipe(res);
    }
  } catch (error) {
    logger.error({ error }, 'WebDAV GET failed');
    next(error);
  }
});

webdavRouter.head('*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const rawPath = decodeURIComponent(req.path.replace(/^\/+/, ''));

    const [fileRecord] = await prisma.$queryRaw<
      Array<{
        id: string;
        display_filename: string;
        size_bytes: string;
        mime_type: string;
        checksum_sha256: string | null;
        updated_at: Date;
      }>
    >`
      SELECT id, display_filename, size_bytes::text, mime_type, checksum_sha256, updated_at
      FROM files
      WHERE user_id = ${userId}::uuid
        AND is_deleted = false
        AND (display_filename = ${rawPath} OR id::text = ${rawPath})
        AND upload_status = 'COMPLETED'::"UploadStatus"
      LIMIT 1;
    `;

    if (!fileRecord) {
      res.status(404).end();
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', fileRecord.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', fileRecord.size_bytes);
    res.setHeader('Last-Modified', new Date(fileRecord.updated_at).toUTCString());
    if (fileRecord.checksum_sha256) {
      res.setHeader('ETag', `"${fileRecord.checksum_sha256}"`);
    }
    res.status(200).end();
  } catch (error) {
    next(error);
  }
});

// ─── 4. PUT Handler (Native Desktop File Upload) ────────────────────────────

webdavRouter.put('*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const filename = decodeURIComponent(req.path.replace(/^\/+/, ''));

    if (!filename || filename === '') {
      res.status(400).send('Filename missing in path');
      return;
    }

    // Ignore macOS system metadata files
    if (filename === '.DS_Store' || filename.startsWith('._')) {
      res.status(201).end();
      return;
    }

    // Collect stream chunks
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('error', (err) => next(err));

    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fileSizeBytes = BigInt(buffer.length);

        if (fileSizeBytes === BigInt(0)) {
          // Zero-byte placeholder files created by Finder before streaming
          res.status(201).end();
          return;
        }

        // Allocate storage on optimal Drive account
        const alloc = await AllocationService.allocateStorage({
          userId,
          originalFilename: filename,
          displayFilename: filename,
          fileSizeBytes,
        });

        // Compute SHA-256
        const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

        // Fetch account refresh token
        const [account] = await prisma.$queryRaw<Array<{ encrypted_refresh_token: string }>>`
          SELECT encrypted_refresh_token
          FROM drive_accounts
          WHERE id = ${alloc.driveAccountId}::uuid
          LIMIT 1;
        `;

        if (!account) {
          throw new Error('Target drive account not found');
        }

        const startTime = Date.now();
        const uploadRes = await GoogleDriveService.uploadFile({
          encryptedRefreshToken: account.encrypted_refresh_token,
          filename,
          mimeType: 'application/octet-stream',
          body: buffer,
        });

        const durationMs = Date.now() - startTime;
        await AllocationService.commitUploadSuccess({
          fileId: alloc.fileId,
          uploadOperationId: alloc.uploadOperationId,
          driveAccountId: alloc.driveAccountId,
          fileSizeBytes,
          reservedBytesToRelease: fileSizeBytes,
          googleDriveFileId: uploadRes.driveFileId,
          checksumSha256,
          durationMs,
          userId,
        });

        res.status(201).end();
      } catch (uploadError) {
        logger.error({ uploadError, filename }, 'WebDAV PUT upload failed');
        next(uploadError);
      }
    });
  } catch (error) {
    next(error);
  }
});

// ─── 5. DELETE Handler (Desktop Move to Trash) ──────────────────────────────

webdavRouter.delete('*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const filename = decodeURIComponent(req.path.replace(/^\/+/, ''));

    if (!filename) {
      res.status(400).send('Filename missing');
      return;
    }

    const [file] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM files
      WHERE user_id = ${userId}::uuid
        AND is_deleted = false
        AND (display_filename = ${filename} OR id::text = ${filename})
      LIMIT 1;
    `;

    if (!file) {
      res.status(404).send('File not found');
      return;
    }

    await FilesService.softDeleteFile(userId, file.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// ─── 6. MOVE Handler (Desktop File Rename) ───────────────────────────────────

webdavRouter.all('*', async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'MOVE') return next();

  try {
    const userId = req.user!.id;
    const sourceFilename = decodeURIComponent(req.path.replace(/^\/+/, ''));
    const destinationHeader = req.headers['destination'];

    if (!destinationHeader || typeof destinationHeader !== 'string') {
      res.status(400).send('Missing Destination header');
      return;
    }

    const destUrl = new URL(destinationHeader, `http://${req.headers.host || 'localhost'}`);
    const destFilename = decodeURIComponent(destUrl.pathname.replace(/^\/webdav\/?/, ''));

    const [file] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM files
      WHERE user_id = ${userId}::uuid
        AND is_deleted = false
        AND (display_filename = ${sourceFilename} OR id::text = ${sourceFilename})
      LIMIT 1;
    `;

    if (!file) {
      res.status(404).send('Source file not found');
      return;
    }

    await FilesService.renameFile(userId, file.id, destFilename);
    res.status(201).end();
  } catch (error) {
    next(error);
  }
});

// ─── 7. LOCK / UNLOCK Handlers (macOS Finder Compatibility) ─────────────────

webdavRouter.all('*', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'LOCK') {
    const lockToken = `opaquelocktoken:${crypto.randomUUID()}`;
    res.setHeader('Lock-Token', `<${lockToken}>`);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>Infinity</D:depth>
      <D:owner><D:href>${escapeXml(req.user?.email || 'ucss')}</D:href></D:owner>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>${lockToken}</D:href></D:locktoken>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
    res.status(200).send(xml);
    return;
  }

  if (req.method === 'UNLOCK') {
    res.status(204).end();
    return;
  }

  if (req.method === 'PROPPATCH') {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"/>`);
    return;
  }

  if (req.method === 'MKCOL') {
    res.status(201).end();
    return;
  }

  next();
});
