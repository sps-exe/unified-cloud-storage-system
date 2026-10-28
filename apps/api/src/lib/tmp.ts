import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from './env.js';

/** Directory where in-flight uploads are spooled; created on demand. */
export function uploadTmpDir(): string {
  const dir = env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), 'ucss-uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
