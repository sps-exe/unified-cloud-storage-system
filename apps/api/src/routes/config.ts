// =============================================================================
// UCSS API — Public runtime config (drives the first-run UI)
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../lib/env.js';
import { AuthService } from '../services/auth.service.js';

export const configRouter = Router();

configRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const hasUsers = (await AuthService.countUsers()) > 0;
    res.json({
      ok: true,
      data: {
        // The first account can always sign up, so a fresh install is never locked out.
        registrationOpen: env.ALLOW_REGISTRATION || !hasUsers,
        firstRun: !hasUsers,
        googleConfigured: env.googleConfigured,
        googleRedirectUri: env.GOOGLE_REDIRECT_URI,
        maxUploadBytes: env.MAX_UPLOAD_BYTES,
        webdavUrl: `${env.APP_URL.replace(/\/$/, '')}/webdav`,
      },
    });
  } catch (error) {
    next(error);
  }
});
