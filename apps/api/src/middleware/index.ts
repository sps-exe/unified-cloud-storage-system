// =============================================================================
// UCSS API — Express Middleware Stack
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { AppError, ValidationError, UnauthorizedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import jwt from 'jsonwebtoken';
import type { ApiError } from '@ucss/shared';

// ─── Auth Middleware ──────────────────────────────────────────────────────────

interface JwtPayload {
  sub: string;   // userId
  email: string;
  iat: number;
  exp: number;
}

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
    }
  }
}

/**
 * requireAuth — Verifies the JWT access token from the Authorization header.
 * Attaches req.user on success. Throws UnauthorizedError on failure.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    req.user = { id: payload['sub'], email: payload['email'] };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new UnauthorizedError('Invalid or expired access token'));
    }
  }
}

// ─── Validation Middleware ────────────────────────────────────────────────────

/**
 * validateBody — Validates req.body against a Zod schema.
 * Returns 400 with field-level errors if validation fails.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.errors[0];
      const message = firstIssue?.message || 'Request body validation failed';
      next(
        new ValidationError(message, result.error.flatten()),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * validateQuery — Validates req.query against a Zod schema.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const firstIssue = result.error.errors[0];
      const message = firstIssue?.message || 'Query parameter validation failed';
      next(
        new ValidationError(message, result.error.flatten()),
      );
      return;
    }
    // Attach parsed/coerced query to req for type safety downstream
    (req as Request & { parsedQuery: T }).parsedQuery = result.data;
    next();
  };
}

// ─── Error Handler ────────────────────────────────────────────────────────────

/**
 * globalErrorHandler — Must be registered LAST in Express middleware chain.
 * Converts all errors (AppError and unexpected) to a consistent API response.
 * NEVER exposes internal stack traces to clients in production.
 */
export function globalErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    // Known, expected errors
    logger.warn(
      { statusCode: error.statusCode, code: error.code, path: req.path },
      error.message,
    );

    const body: ApiError = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        // Only include details in non-production environments
        ...(env.NODE_ENV !== 'production' && error.details !== undefined
          ? { details: error.details }
          : {}),
      },
    };

    res.status(error.statusCode).json(body);
    return;
  }

  // Unknown errors — log full details server-side, return generic message to client
  logger.error(
    { error, path: req.path, method: req.method },
    'Unhandled error in request handler',
  );

  const body: ApiError = {
    ok: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    },
  };

  res.status(500).json(body);
}

// ─── Not Found Handler ────────────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiError = {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist`,
    },
  };
  res.status(404).json(body);
}
