// =============================================================================
// UCSS API — Admin & Reconciliation Router
// =============================================================================
// Administrative endpoints for system health monitoring, consistency audits,
// manual trigger of background reconciliation, and stuck upload recovery.
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, validateBody } from '../middleware/index.js';
import { ReconciliationService } from '../services/reconciliation.service.js';

export const adminRouter = Router();

const reconcileOptionsSchema = z.object({
  uploadingThresholdMinutes: z.number().int().min(0).max(1440).optional(),
  pendingThresholdMinutes: z.number().int().min(0).max(1440).optional(),
});

/**
 * GET /api/admin/health
 * Returns deep system health diagnostics across files, accounts, and quotas.
 */
adminRouter.get('/health', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await ReconciliationService.getHealthSummary();
    res.json({
      ok: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/reconcile
 * Executes full reconciliation: stuck upload recovery, orphaned reservation cleanup,
 * and quota sync across all connected accounts.
 */
adminRouter.post(
  '/reconcile',
  requireAuth,
  validateBody(reconcileOptionsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const options = req.body;
      const report = await ReconciliationService.runFullReconciliation(options);
      res.json({
        ok: true,
        data: report,
      });
    } catch (err) {
      next(err);
    }
  },
);
