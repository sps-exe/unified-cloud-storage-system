// =============================================================================
// UCSS API — Express Application
// =============================================================================
// app.ts creates and configures the Express app (middleware + routes).
// server.ts starts the HTTP server. Separating them makes testing easier —
// Supertest can import the app without binding to a port.

import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { globalErrorHandler, notFoundHandler } from './middleware/index.js';

// Route imports (added as each phase builds them)
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { accountsRouter } from './routes/accounts.js';
import { filesRouter } from './routes/files.js';
import { oauthRouter } from './routes/oauth.js';
import { adminRouter } from './routes/admin.js';
import { webdavRouter } from './routes/webdav.js';

export function createApp() {
  const app = express();

  // ─── Request Correlation ID Middleware ─────────────────────────────────────
  app.use((req, res, next) => {
    const rawId = req.headers['x-request-id'];
    const correlationId = typeof rawId === 'string' && rawId.length > 0 ? rawId : crypto.randomUUID();
    res.setHeader('X-Request-ID', correlationId);
    (req as any).id = correlationId;
    next();
  });

  // ─── Security Headers ───────────────────────────────────────────────────────
  app.use(helmet(
    env.NODE_ENV === 'production'
      ? undefined
      : { contentSecurityPolicy: false }
  ));

  // ─── WebDAV Pre-Routing Discovery Interceptor (RFC 4918) ────────────────────
  app.options('/webdav*', (_req, res) => {
    res.setHeader('DAV', '1, 2');
    res.setHeader('MS-Author-Via', 'DAV');
    res.setHeader(
      'Allow',
      'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK',
    );
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK, PROPPATCH, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Depth, Destination, Range, If, Lock-Token, Timeout');
    res.setHeader('Access-Control-Expose-Headers', 'DAV, Lock-Token, Content-Range, Accept-Ranges');
    res.status(200).end();
  });

  // ─── CORS ────────────────────────────────────────────────────────────────────
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or same-origin static frontend)
      if (!origin) return callback(null, true);
      const allowed = [
        env.FRONTEND_URL,
        'http://localhost:4000',
        'http://localhost:5173',
        'http://127.0.0.1:4000',
        'http://127.0.0.1:5173',
      ];
      if (allowed.includes(origin) || origin === env.FRONTEND_URL) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in dev/local for seamless multi-port development
    },
    credentials: true, // Required for cookie-based refresh tokens
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY', 'LOCK', 'UNLOCK', 'PROPPATCH', 'HEAD', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Depth', 'Destination', 'Range', 'If', 'Lock-Token', 'Timeout'],
    exposedHeaders: ['X-Request-ID', 'DAV', 'Lock-Token', 'Content-Range', 'Accept-Ranges'],
  }));

  // ─── Rate Limiting ────────────────────────────────────────────────────────────
  if (env.NODE_ENV !== 'test') {
    const isLocalhost = (ip?: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

    // General API limit — prevents abuse
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => env.NODE_ENV !== 'production' && isLocalhost(req.ip),
      message: { ok: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
    });

    // Auth endpoints — brute force protection in production
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: env.NODE_ENV === 'production' ? 30 : 500,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => env.NODE_ENV !== 'production' && isLocalhost(req.ip),
      message: { ok: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many authentication attempts. Please try again later.' } },
    });

    // Upload-specific limit — prevents quota exhaustion attacks
    const uploadLimiter = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 100, // 100 uploads per hour per IP
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => env.NODE_ENV !== 'production' && isLocalhost(req.ip),
      message: { ok: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Upload rate limit exceeded' } },
    });

    app.use('/api', apiLimiter);
    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', authLimiter);
    app.use('/api/files/upload', uploadLimiter);
  }

  // ─── Body Parsing ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10kb' })); // Reject oversized JSON bodies
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));
  app.use(cookieParser());

  // ─── Request Logging ──────────────────────────────────────────────────────────
  const pinoMiddleware = (pinoHttp as any).default || pinoHttp;
  app.use(pinoMiddleware({
    logger,
    // Don't log health check requests — they're noise
    autoLogging: {
      ignore: (req: any) => req.url === '/api/health',
    },
    // Redact sensitive headers from logs
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  }));

  // ─── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/oauth', oauthRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/webdav', webdavRouter);

  // ─── Static Frontend Serving (Unified Deployment Mode) ───────────────────────
  const webDistPath = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/webdav')) return next();
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  // ─── Error Handling (MUST be last) ───────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
