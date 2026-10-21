// =============================================================================
// UCSS API — Authentication Routes
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/auth.service.js';
import { requireAuth, validateBody } from '../middleware/index.js';
import { env } from '../lib/env.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { ApiResponse } from '@ucss/shared';

export const authRouter = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Please provide a valid email address')
    .max(255, 'Email cannot exceed 255 characters')
    .toLowerCase()
    .trim(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password cannot exceed 100 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  displayName: z
    .string()
    .trim()
    .max(100, 'Display name cannot exceed 100 characters')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export const loginSchema = z.object({
  email: z.string().email('Please provide a valid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

const REFRESH_COOKIE_NAME = 'ucss_refresh_token';

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
    path: '/',
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
authRouter.post(
  '/register',
  validateBody(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user, tokens } = await AuthService.register(req.body);
      setRefreshCookie(res, tokens.refreshToken);

      const response: ApiResponse<{
        user: typeof user;
        accessToken: string;
        refreshToken: string;
      }> = {
        ok: true,
        data: {
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  },
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
authRouter.post(
  '/login',
  validateBody(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const clientIp = req.ip || req.socket.remoteAddress;

      const { user, tokens } = await AuthService.login(email, password, clientIp);
      setRefreshCookie(res, tokens.refreshToken);

      const response: ApiResponse<{
        user: typeof user;
        accessToken: string;
        refreshToken: string;
      }> = {
        ok: true,
        data: {
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  },
);

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ??
      req.body?.refreshToken;

    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedError('Refresh token required');
    }

    const newAccessToken = await AuthService.refreshAccessToken(rawToken);

    const response: ApiResponse<{ accessToken: string; refreshToken?: string }> = {
      ok: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: rawToken,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
authRouter.post('/logout', (_req: Request, res: Response) => {
  clearRefreshCookie(res);
  const response: ApiResponse<{ message: string }> = {
    ok: true,
    data: { message: 'Logged out successfully' },
  };
  res.status(200).json(response);
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
authRouter.get(
  '/me',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const profileWithStats = await AuthService.getUserWithStats(userId);

      const response: ApiResponse<typeof profileWithStats & { user: { id: string; email: string; displayName: string | null } }> = {
        ok: true,
        data: {
          ...profileWithStats,
          user: {
            id: profileWithStats.id,
            email: profileWithStats.email,
            displayName: profileWithStats.displayName,
          },
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  },
);
