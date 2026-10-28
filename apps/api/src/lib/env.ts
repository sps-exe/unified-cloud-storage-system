// =============================================================================
// UCSS API — Environment Configuration
// =============================================================================
// Zod validates ALL env vars at startup. If any required var is missing,
// the process CRASHES IMMEDIATELY with a clear error message.
// This is intentional: failing fast on startup is better than failing
// silently mid-request with a cryptic undefined error.

import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Database
  DATABASE_URL: z.string().url().startsWith('postgresql://'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Token Encryption (AES-256-GCM). 64 hex chars are used as-is; any other string (>= 32 chars,
  // e.g. a PaaS-generated base64 secret) is hashed with SHA-256 into a 32-byte key.
  TOKEN_ENCRYPTION_KEY: z.string().min(32, 'TOKEN_ENCRYPTION_KEY must be at least 32 characters (64 hex chars recommended)'),

  // Google OAuth — optional so a fresh install boots; the UI shows setup steps until set
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default(''),

  // Public base URL of this server (OAuth redirects, WebDAV URL shown in the UI)
  APP_URL: z.string().url().default('http://localhost:4000'),
  // Extra browser origin allowed by CORS (e.g. the Vite dev server)
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  // Set to the number of reverse proxies in front of the API (Render/Railway/nginx = 1)
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Product settings
  ALLOW_REGISTRATION: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  UPLOAD_TMP_DIR: z.string().default(''),
  WEB_DIST_DIR: z.string().default(''),
  RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(10), // 0 disables

  // Storage allocation config (bytes)
  QUOTA_SAFETY_MARGIN_BYTES: z.coerce.bigint().default(BigInt(500 * 1024 * 1024)), // 500MB
  QUOTA_STALE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(300),   // 5 min

  // Reconciliation
  STUCK_UPLOAD_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(30),
  STUCK_PENDING_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(5),
});

// Parse and validate. Throws ZodError with clear field-level errors if invalid.
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = {
  ...parsed.data,
  GOOGLE_REDIRECT_URI:
    parsed.data.GOOGLE_REDIRECT_URI || `${parsed.data.APP_URL.replace(/\/$/, '')}/api/oauth/google/callback`,
  googleConfigured: Boolean(parsed.data.GOOGLE_CLIENT_ID && parsed.data.GOOGLE_CLIENT_SECRET),
};
export type Env = typeof env;
