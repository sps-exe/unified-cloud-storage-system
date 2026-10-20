// =============================================================================
// UCSS API — Accounts Routes
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { AccountsService } from '../services/accounts.service.js';
import { requireAuth } from '../middleware/index.js';
import type { ApiResponse } from '@ucss/shared';

export const accountsRouter = Router();

// Protect all account routes with JWT authentication
accountsRouter.use(requireAuth);

// ─── GET /api/accounts ────────────────────────────────────────────────────────
// Lists all connected Google Drive accounts with available storage and file counts
accountsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const accounts = await AccountsService.listAccounts(userId);

      const response: ApiResponse<typeof accounts> = {
        ok: true,
        data: accounts,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  },
);

// ─── POST /api/accounts/:id/sync ──────────────────────────────────────────────
// Forces an immediate quota sync with Google Drive API and takes a snapshot
accountsRouter.post(
  '/:id/sync',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const accountId = req.params['id']!;

      const updated = await AccountsService.syncAccount(userId, accountId);

      const response: ApiResponse<typeof updated> = {
        ok: true,
        data: updated,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  },
);

// ─── DELETE /api/accounts/:id ─────────────────────────────────────────────────
// Disconnects an account (marks status DISCONNECTED, preserves active files)
accountsRouter.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const accountId = req.params['id']!;

      const result = await AccountsService.disconnectAccount(userId, accountId);

      const response: ApiResponse<typeof result> = {
        ok: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  },
);
