// =============================================================================
// UCSS API — HTTP Server Entry Point
// =============================================================================

import { createApp } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { prisma } from '@ucss/database';
import fs from 'node:fs';
import { ReconciliationService } from './services/reconciliation.service.js';
import { uploadTmpDir } from './lib/tmp.js';

async function main() {
  // Verify database connection before accepting traffic
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ Database connection verified');
  } catch (error) {
    logger.fatal({ error }, '❌ Failed to connect to database. Exiting.');
    process.exit(1);
  }

  // Spool files left behind by a crash/restart are unreachable; clear them.
  try {
    const dir = uploadTmpDir();
    for (const f of fs.readdirSync(dir)) fs.rmSync(`${dir}/${f}`, { force: true });
  } catch (error) {
    logger.warn({ error }, 'Could not clean upload temp dir');
  }

  const app = createApp();

  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        frontend: env.FRONTEND_URL,
      },
      `🚀 UCSS API running on port ${env.PORT}`,
    );
  });

  // ─── Background reconciliation ─────────────────────────────────────────────
  // Recovers stuck uploads, repairs reservation drift and refreshes Drive quotas.
  let reconciling = false;
  const runReconciliation = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await ReconciliationService.runFullReconciliation();
    } catch (error) {
      logger.error({ error }, 'Background reconciliation failed');
    } finally {
      reconciling = false;
    }
  };
  const reconcileTimer =
    env.RECONCILE_INTERVAL_MINUTES > 0
      ? setInterval(runReconciliation, env.RECONCILE_INTERVAL_MINUTES * 60_000)
      : undefined;
  reconcileTimer?.unref();
  if (reconcileTimer) setTimeout(runReconciliation, 30_000).unref();

  // ─── Graceful Shutdown ─────────────────────────────────────────────────────
  // On SIGTERM (sent by Railway/Docker during deployment or shutdown):
  //   1. Stop accepting new connections
  //   2. Wait for in-flight requests to complete
  //   3. Disconnect from DB
  //   4. Exit cleanly
  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);
    if (reconcileTimer) clearInterval(reconcileTimer);

    server.close(async () => {
      logger.info('HTTP server closed');

      await prisma.$disconnect();
      logger.info('Database disconnected');

      process.exit(0);
    });

    // Force exit after 30 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 30_000);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A stray rejection (e.g. a dropped Drive stream) must not take every user's session down.
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
