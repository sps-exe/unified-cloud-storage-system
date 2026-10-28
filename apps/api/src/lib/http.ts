// =============================================================================
// UCSS API — Shared HTTP helpers (ranges, download headers, stream piping)
// =============================================================================

import type { Response } from 'express';
import type { Readable } from 'node:stream';
import { logger } from './logger.js';

export type ByteRange = { start: bigint; end: bigint } | 'unsatisfiable' | null;

/**
 * Parses a single-range `Range: bytes=…` header against a known size.
 * Supports `a-b`, `a-` and suffix `-n`; clamps `b` to size-1 like RFC 9110.
 * Returns null when there is no (usable) range → serve the full body.
 * shortcut: multi-range requests are served as a full 200, upgrade if a client needs multipart/byteranges.
 */
export function parseRange(header: string | undefined, size: bigint): ByteRange {
  if (!header || !header.startsWith('bytes=') || header.includes(',')) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;

  let start: bigint;
  let end: bigint;
  if (m[1] === '') {
    const suffix = BigInt(m[2]!);
    if (suffix === 0n) return 'unsatisfiable';
    start = suffix >= size ? 0n : size - suffix;
    end = size - 1n;
  } else {
    start = BigInt(m[1]!);
    end = m[2] === '' ? size - 1n : BigInt(m[2]!);
    if (end >= size) end = size - 1n;
  }
  if (size === 0n || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Pipes a Drive stream to the response and tears both down if either side dies. */
export function pipeToResponse(source: Readable, res: Response): void {
  source.on('error', (error) => {
    logger.warn({ error }, 'Drive stream failed mid-transfer');
    if (!res.headersSent) res.status(502);
    res.destroy(error);
  });
  res.on('close', () => source.destroy());
  source.pipe(res);
}

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Best-effort MIME type from a filename; WebDAV clients rarely send a useful Content-Type. */
export function guessMime(filename: string, declared?: string): string {
  if (declared && declared !== 'application/octet-stream') return declared;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
