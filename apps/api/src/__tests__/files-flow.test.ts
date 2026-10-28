// =============================================================================
// Upload → list → range-stream → delete, against a real Postgres and a fake Drive.
// Run with a throwaway DB:  DATABASE_URL=postgresql://…/ucss_scratch pnpm --filter @ucss/api test
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { prisma } from '@ucss/database';
import { createApp } from '../app.js';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { encryptToken } from '../lib/crypto.js';

const app = createApp();
const drive = new Map<string, Buffer>();

const email = `flow_${Date.now()}@ucss.dev`;
const password = 'Password123!@#';
const content = Buffer.from('héllo unified storage — 0123456789');
let token = '';
let userId = '';
let accountId = '';

const used = async () =>
  (await prisma.$queryRaw<Array<{ u: string; r: string }>>`
    SELECT quota_used_bytes::text AS u, reserved_bytes::text AS r FROM drive_accounts WHERE id = ${accountId}::uuid`)[0]!;

beforeAll(async () => {
  vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async ({ body }) => {
    const chunks: Buffer[] = [];
    const source = typeof body === 'function' ? body() : body;
    for await (const c of source as AsyncIterable<Buffer>) chunks.push(c);
    const id = `drive-${drive.size + 1}`;
    drive.set(id, Buffer.concat(chunks));
    return { driveFileId: id };
  });
  vi.spyOn(GoogleDriveService, 'downloadFileStream').mockImplementation(async ({ driveFileId, range }) => {
    const buf = drive.get(driveFileId)!;
    const m = range && /bytes=(\d+)-(\d+)/.exec(range);
    return Readable.from(m ? buf.subarray(Number(m[1]), Number(m[2]) + 1) : buf);
  });
  vi.spyOn(GoogleDriveService, 'deleteFile').mockImplementation(async (_t, id) => drive.delete(id));

  const reg = await request(app).post('/api/auth/register').send({ email, password });
  token = reg.body.data.accessToken;
  userId = reg.body.data.user.id;
  const [acc] = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO drive_accounts (id, user_id, google_email, google_account_id, encrypted_refresh_token, status,
      quota_limit_bytes, quota_used_bytes, reserved_bytes, updated_at)
    VALUES (gen_random_uuid(), ${userId}::uuid, 'fake@gmail.com', 'perm-1', ${encryptToken('fake')},
      'ACTIVE'::"AccountStatus", 16106127360, 0, 0, NOW())
    RETURNING id`;
  accountId = acc!.id;
});

afterAll(async () => {
  // files → drive_accounts is ON DELETE RESTRICT, so clear files before the user cascade
  await prisma.$executeRaw`DELETE FROM files WHERE user_id = ${userId}::uuid`;
  await prisma.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
  vi.restoreAllMocks();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('file lifecycle', () => {
  let fileId = '';

  it('uploads a file (multipart → disk → Drive) and commits quota', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set(auth())
      .attach('file', content, { filename: 'résumé.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    fileId = res.body.data.id;
    expect(res.body.data.originalFilename).toBe('résumé.txt');
    expect(res.body.data.checksumSha256).toBe(crypto.createHash('sha256').update(content).digest('hex'));
    expect(await used()).toEqual({ u: String(content.length), r: '0' });
  });

  it('lists with working type filters', async () => {
    const hit = await request(app).get('/api/files?mimeType=text/').set(auth());
    expect(hit.body.data).toHaveLength(1);
    const multi = await request(app).get('/api/files?mimeType=image/,text/plain').set(auth());
    expect(multi.body.data).toHaveLength(1);
    const miss = await request(app).get('/api/files?mimeType=image/').set(auth());
    expect(miss.body.data).toHaveLength(0);
    const byUpdated = await request(app).get('/api/files?sortBy=updatedAt&sortOrder=asc').set(auth());
    expect(byUpdated.status).toBe(200);
  });

  it('serves ranges, suffix ranges and rejects unsatisfiable ones', async () => {
    const part = await request(app).get(`/api/files/${fileId}/stream`).set(auth()).set('Range', 'bytes=2-5').buffer().parse(binary);
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 2-5/${content.length}`);
    expect(Buffer.from(part.body)).toEqual(content.subarray(2, 6));

    const full = await request(app).get(`/api/files/${fileId}/download`).set(auth()).buffer().parse(binary);
    expect(full.status).toBe(200);
    expect(full.headers['content-disposition']).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.txt");
    expect(Buffer.from(full.body)).toEqual(content);

    const bad = await request(app).get(`/api/files/${fileId}/stream`).set(auth()).set('Range', 'bytes=9999-');
    expect(bad.status).toBe(416);
  });

  it('only accepts ?token= on content endpoints', async () => {
    expect((await request(app).get(`/api/files/${fileId}/stream?token=${token}`)).status).toBe(200);
    expect((await request(app).get(`/api/files?token=${token}`)).status).toBe(401);
    expect((await request(app).get('/api/files/not-a-uuid').set(auth())).status).toBe(404);
  });

  it('scopes admin health to the caller', async () => {
    const res = await request(app).get('/api/admin/health').set(auth());
    expect(res.body.data.completedFiles).toBe(1);
  });

  it('deletes from Drive and frees the quota', async () => {
    const res = await request(app).delete(`/api/files/${fileId}`).set(auth());
    expect(res.status).toBe(200);
    expect(drive.size).toBe(0);
    expect(await used()).toEqual({ u: '0', r: '0' });
    expect((await request(app).get('/api/files').set(auth())).body.data).toHaveLength(0);
  });

  it('releases the reservation when the Drive upload fails', async () => {
    vi.mocked(GoogleDriveService.uploadFile).mockRejectedValueOnce(new Error('drive down'));
    const res = await request(app).post('/api/files/upload').set(auth()).attach('file', content, 'x.txt');
    expect(res.status).toBe(500);
    expect(await used()).toEqual({ u: '0', r: '0' });
  });
});

describe('public config', () => {
  it('reports setup state without auth', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ registrationOpen: true });
    expect(typeof res.body.data.googleConfigured).toBe('boolean');
  });
});

function binary(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
