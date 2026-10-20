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

  // Token Encryption (AES-256-GCM — 32 bytes = 64 hex chars)
  TOKEN_ENCRYPTION_KEY: z.string().length(64, 'TOKEN_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),

  // CORS
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

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

export const env = parsed.data;
export type Env = typeof env;
