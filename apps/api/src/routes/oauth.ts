// =============================================================================
// UCSS API — OAuth Routes
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { AccountsService } from '../services/accounts.service.js';
import { requireAuth } from '../middleware/index.js';
import { ValidationError } from '../lib/errors.js';
import { env } from '../lib/env.js';
import type { ApiResponse } from '@ucss/shared';

export const oauthRouter = Router();

// ─── GET /api/oauth/google/connect ───────────────────────────────────────────
// Generates the Google OAuth authorization URL containing an encrypted state parameter
oauthRouter.get(
  '/google/connect',
  requireAuth,
  (req: Request, res: Response) => {
    const userId = req.user!.id;
    const url = GoogleDriveService.getAuthorizationUrl(userId);

    const response: ApiResponse<{ url: string }> = {
      ok: true,
      data: { url },
    };

    res.status(200).json(response);
  },
);

// ─── GET /api/oauth/google/callback ──────────────────────────────────────────
// Handles Google redirect back with auth code & state parameter
oauthRouter.get(
  '/google/callback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = req.query['code'];
      const state = req.query['state'];

      if (typeof code !== 'string' || typeof state !== 'string') {
        throw new ValidationError('Missing authorization code or state parameter');
      }

      // Verify CSRF state and extract userId
      const { userId } = GoogleDriveService.verifyState(state);

      // Exchange code and upsert drive account
      const account = await AccountsService.connectAccount(userId, code);

      // If client prefers JSON (e.g., API test), return JSON
      if (req.headers.accept?.includes('application/json')) {
        const response: ApiResponse<typeof account> = {
          ok: true,
          data: account,
        };
        res.status(200).json(response);
        return;
      }

      // Otherwise redirect back to frontend dashboard
      res.redirect(`${env.FRONTEND_URL}/accounts?connected=true&email=${encodeURIComponent(account.googleEmail)}`);
    } catch (error) {
      next(error);
    }
  },
);
