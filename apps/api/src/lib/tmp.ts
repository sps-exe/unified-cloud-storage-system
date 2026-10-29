import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from './env.js';

/** Directory where in-flight uploads are spooled; created on demand. */
export function uploadTmpDir(): string {
  // Always a dedicated subfolder: startup wipes it, so it must never be a shared directory like /tmp.
  const dir = path.join(env.UPLOAD_TMP_DIR || os.tmpdir(), 'ucss-uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
