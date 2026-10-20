// =============================================================================
// UCSS — Raw SQL Pool Client
// =============================================================================
// A dedicated pg.Pool for queries that require PostgreSQL-specific features
// that Prisma cannot express: advisory locks, FOR UPDATE SKIP LOCKED,
// LATERAL joins, and complex CTEs with side effects.
//
// Both this pool AND the Prisma client connect to the same DATABASE_URL.
// They do NOT share connections — they have separate connection pools.

import { Pool, type PoolConfig } from 'pg';

const config: PoolConfig = {
  connectionString: process.env['DATABASE_URL'],
  // Connection pool sizing — suitable for single-server monolith
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

// Global singleton pool
const globalForPool = globalThis as unknown as {
  pgPool: Pool | undefined;
};

export const pgPool = globalForPool.pgPool ?? new Pool(config);

if (process.env['NODE_ENV'] !== 'production') {
  globalForPool.pgPool = pgPool;
}

// Graceful shutdown handler — drain connections cleanly
process.on('SIGTERM', async () => {
  await pgPool.end();
});
