// =============================================================================
// UCSS API — Health Check Route
// GET /api/health
// =============================================================================
import { Router, type Request, type Response } from 'express';
import { prisma } from '@ucss/database';
import type { ApiSuccess } from '@ucss/shared';

export const healthRouter = Router();

interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  database: 'connected' | 'disconnected';
  version: string;
}

// Liveness probe — returns 200 if process is running
healthRouter.get('/', async (_req: Request, res: Response) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    // DB is down — service is degraded but still responds
  }

  const payload: ApiSuccess<HealthResponse> = {
    ok: true,
    data: {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      version: process.env['npm_package_version'] ?? '1.0.0',
    },
  };

  res.status(dbStatus === 'connected' ? 200 : 503).json(payload);
});

// Readiness probe — strictly verifies database connectivity for Kubernetes/load balancers
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;

    res.status(200).json({
      ok: true,
      data: {
        ready: true,
        database: 'connected',
        latencyMs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: {
        code: 'NOT_READY',
        message: 'Database connection failed',
        details: err instanceof Error ? err.message : String(err),
      },
    });
  }
});
