// =============================================================================
// UCSS API — HTTP Server Entry Point
// =============================================================================

import { createApp } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { prisma } from '@ucss/database';

async function main() {
  // Verify database connection before accepting traffic
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ Database connection verified');
  } catch (error) {
    logger.fatal({ error }, '❌ Failed to connect to database. Exiting.');
    process.exit(1);
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

  // ─── Graceful Shutdown ─────────────────────────────────────────────────────
  // On SIGTERM (sent by Railway/Docker during deployment or shutdown):
  //   1. Stop accepting new connections
  //   2. Wait for in-flight requests to complete
  //   3. Disconnect from DB
  //   4. Exit cleanly
  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);

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

  // Handle unhandled promise rejections — log and exit
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection — exiting');
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
