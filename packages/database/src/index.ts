// =============================================================================
// @ucss/database — Public API
// =============================================================================

// Prisma Client (ORM — for simple CRUD and migrations)
export { prisma } from './client.js';

// Raw pg Pool (for complex SQL — allocation, reconciliation, analytics)
export { pgPool } from './pool.js';

// Re-export all Prisma generated types
export * from '@prisma/client';
