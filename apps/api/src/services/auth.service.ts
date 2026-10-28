// =============================================================================
// UCSS API — Authentication Service
// =============================================================================
// Handles user registration, credential verification, JWT issuance,
// refresh token rotation, and storage dashboard aggregation.
//
// RAW SQL USAGE:
// Uses prisma.$queryRaw for user queries and single-pass aggregated metrics.
// =============================================================================

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@ucss/database';
import { env } from '../lib/env.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  NotFoundError,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const SALT_ROUNDS = 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date;
}

export interface UserWithStats extends UserProfile {
  storage: {
    totalQuotaBytes: string;
    totalUsedBytes: string;
    totalReservedBytes: string;
    totalAvailableBytes: string;
    activeAccountsCount: number;
    totalAccountsCount: number;
    totalFilesCount: number;
  };
}

export class AuthService {
  /**
   * Generates a 15-minute access token and a 7-day refresh token.
   */
  static generateTokens(userId: string, email: string): TokenPair {
    const accessToken = jwt.sign(
      { sub: userId, email },
      env.JWT_ACCESS_SECRET,
      { expiresIn: (env.JWT_ACCESS_EXPIRES_IN || '15m') as any },
    );

    const refreshToken = jwt.sign(
      { sub: userId, email, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: (env.JWT_REFRESH_EXPIRES_IN || '7d') as any },
    );

    return { accessToken, refreshToken };
  }

  /**
   * Registers a new user with bcrypt password hashing (12 rounds).
   * Verifies email uniqueness using a case-insensitive check.
   */
  static async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // Self-hosters can close signups once their own account exists (the first user is always allowed).
    if (!env.ALLOW_REGISTRATION && (await this.countUsers()) > 0) {
      throw new ForbiddenError('Registration is disabled on this server');
    }

    // Raw SQL check for existing user (case-insensitive)
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users WHERE LOWER(email) = LOWER(${normalizedEmail}) LIMIT 1
    `;

    if (existing.length > 0) {
      throw new ConflictError('An account with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const displayName = input.displayName?.trim() || normalizedEmail.split('@')[0];

    // Raw SQL atomic insertion returning created user; the unique index settles concurrent signups.
    const [created] = await prisma.$queryRaw<Array<UserProfile>>`
      INSERT INTO users (
        id,
        email,
        password_hash,
        display_name,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        ${normalizedEmail},
        ${passwordHash},
        ${displayName},
        NOW(),
        NOW()
      )
      RETURNING id, email, display_name AS "displayName", created_at AS "createdAt"
    `.catch((error: unknown) => {
      if (String((error as Error)?.message).includes('23505')) {
        throw new ConflictError('An account with this email address already exists');
      }
      throw error;
    });

    if (!created) {
      throw new AppError(500, 'USER_CREATION_FAILED', 'Failed to create user record');
    }

    logger.info({ userId: created.id, email: created.email }, 'User registered successfully');

    const tokens = this.generateTokens(created.id, created.email);
    return { user: created, tokens };
  }

  /**
   * Authenticates a user by email and password.
   * Compares password with bcrypt hash and emits audit log.
   */
  static async login(
    email: string,
    password: string,
    clientIp?: string,
    options: { audit?: boolean } = {},
  ): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const normalizedEmail = email.toLowerCase().trim();

    const [user] = await prisma.$queryRaw<
      Array<UserProfile & { password_hash: string }>
    >`
      SELECT 
        id,
        email,
        password_hash,
        display_name AS "displayName",
        created_at AS "createdAt"
      FROM users
      WHERE LOWER(email) = LOWER(${normalizedEmail})
      LIMIT 1
    `;

    if (!user) {
      logger.warn({ email: normalizedEmail, ip: clientIp }, 'Login failed: user not found');
      throw new UnauthorizedError('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      logger.warn({ userId: user.id, email: normalizedEmail, ip: clientIp }, 'Login failed: invalid password');
      throw new UnauthorizedError('Invalid email or password');
    }

    // Insert structured audit log (skipped for per-request WebDAV Basic auth)
    try {
      if (options.audit !== false) await prisma.$executeRaw`
        INSERT INTO audit_logs (
          id,
          user_id,
          action,
          resource_type,
          resource_id,
          metadata,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          ${user.id}::uuid,
          'AUTH_LOGIN',
          'USER',
          ${user.id}::uuid,
          ${JSON.stringify({ ip: clientIp ?? '127.0.0.1', timestamp: new Date().toISOString() })}::json,
          NOW()
        )
      `;
    } catch (auditError) {
      logger.error({ auditError }, 'Failed to write audit log for login');
    }

    logger.info({ userId: user.id, email: user.email }, 'User logged in successfully');

    const tokens = this.generateTokens(user.id, user.email);
    const userProfile: UserProfile = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    };

    return { user: userProfile, tokens };
  }

  static async countUsers(): Promise<number> {
    const [row] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM users`;
    return row?.n ?? 0;
  }

  /**
   * Validates a refresh token and issues a new access token.
   */
  static async refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
        sub: string;
        email: string;
        type?: string;
      };

      if (payload.type !== 'refresh') {
        throw new UnauthorizedError('Invalid token type for refresh');
      }

      // Verify user still exists in database
      const [user] = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
        SELECT id, email FROM users WHERE id = ${payload.sub}::uuid LIMIT 1
      `;

      if (!user) {
        throw new UnauthorizedError('User account associated with token no longer exists');
      }

      const accessToken = jwt.sign(
        { sub: user.id, email: user.email },
        env.JWT_ACCESS_SECRET,
        { expiresIn: (env.JWT_ACCESS_EXPIRES_IN || '15m') as any },
      );

      return accessToken;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
  }

  /**
   * Fetches the user profile and aggregates storage metrics across all connected
   * Google Drive accounts in a SINGLE high-efficiency raw SQL query.
   */
  static async getUserWithStats(userId: string): Promise<UserWithStats> {
    interface RawQueryResult {
      id: string;
      email: string;
      displayName: string | null;
      createdAt: Date;
      totalQuotaBytes: string;
      totalUsedBytes: string;
      totalReservedBytes: string;
      totalAvailableBytes: string;
      activeAccountsCount: number;
      totalAccountsCount: number;
      totalFilesCount: number;
    }

    const [row] = await prisma.$queryRaw<Array<RawQueryResult>>`
      SELECT 
        u.id,
        u.email,
        u.display_name AS "displayName",
        u.created_at AS "createdAt",
        COALESCE(SUM(da.quota_limit_bytes), 0)::text AS "totalQuotaBytes",
        COALESCE(SUM(da.quota_used_bytes), 0)::text AS "totalUsedBytes",
        COALESCE(SUM(da.reserved_bytes), 0)::text AS "totalReservedBytes",
        COALESCE(
          SUM(
            GREATEST(
              0::bigint,
              da.quota_limit_bytes - da.quota_used_bytes - da.reserved_bytes
            )
          ),
          0
        )::text AS "totalAvailableBytes",
        COUNT(da.id) FILTER (WHERE da.status = 'ACTIVE')::int AS "activeAccountsCount",
        COUNT(da.id)::int AS "totalAccountsCount",
        (
          SELECT COUNT(*)::int
          FROM files f
          WHERE f.user_id = u.id AND f.is_deleted = FALSE
        ) AS "totalFilesCount"
      FROM users u
      LEFT JOIN drive_accounts da ON da.user_id = u.id
      WHERE u.id = ${userId}::uuid
      GROUP BY u.id
      LIMIT 1
    `;

    if (!row) {
      throw new NotFoundError('User');
    }

    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      createdAt: row.createdAt,
      storage: {
        totalQuotaBytes: row.totalQuotaBytes,
        totalUsedBytes: row.totalUsedBytes,
        totalReservedBytes: row.totalReservedBytes,
        totalAvailableBytes: row.totalAvailableBytes,
        activeAccountsCount: row.activeAccountsCount,
        totalAccountsCount: row.totalAccountsCount,
        totalFilesCount: row.totalFilesCount,
      },
    };
  }
}
