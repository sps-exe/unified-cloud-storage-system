#!/usr/bin/env node
// First-run helper: creates .env from .env.example with freshly generated secrets.
// Safe to re-run — an existing .env is never overwritten (pass --force to replace it).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

if (fs.existsSync(envPath) && !process.argv.includes('--force')) {
  console.log('.env already exists — leaving it untouched (use --force to regenerate).');
  process.exit(0);
}

const dbPassword = hex(16);
const values = {
  POSTGRES_PASSWORD: dbPassword,
  DATABASE_URL: `postgresql://ucss_user:${dbPassword}@localhost:5432/ucss_db`,
  JWT_ACCESS_SECRET: hex(64),
  JWT_REFRESH_SECRET: hex(64),
  TOKEN_ENCRYPTION_KEY: hex(32),
};

let out = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const [key, value] of Object.entries(values)) {
  out = out.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
}
fs.writeFileSync(envPath, out, { mode: 0o600 });

console.log(`Created ${path.relative(process.cwd(), envPath) || '.env'} with fresh secrets.

Next:
  1. Back up TOKEN_ENCRYPTION_KEY — without it, connected Drive accounts must be re-linked.
  2. (Optional now, required to link Drive) add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
     Guide: docs/google-oauth-setup.md
  3. Start everything:   docker compose up -d --build
     or without Docker:  pnpm db:deploy && pnpm build && pnpm start
  4. Open ${'http://localhost:4000'} and create your account.
`);
