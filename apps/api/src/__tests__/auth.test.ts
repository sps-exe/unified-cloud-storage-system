// =============================================================================
// UCSS API — Authentication Integration Tests
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '@ucss/database';

const app = createApp();

describe('Auth Endpoints (/api/auth)', () => {
  const testEmail = `test_${Date.now()}@ucss.dev`;
  const testPassword = 'Password123!@#';
  const testDisplayName = 'Test Engineer';

  let accessToken = '';
  let refreshTokenCookie = '';

  afterAll(async () => {
    // Clean up test user created during the test run
    try {
      await prisma.$executeRaw`
        DELETE FROM users WHERE email = ${testEmail.toLowerCase()}
      `;
    } catch {
      // Ignore
    }
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user with valid credentials and return tokens', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          displayName: testDisplayName,
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.user.displayName).toBe(testDisplayName);
      expect(res.body.data.accessToken).toBeDefined();

      // Check refresh token cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const hasCookie = cookies?.some((c: string) => c.startsWith('ucss_refresh_token='));
      expect(hasCookie).toBe(true);

      accessToken = res.body.data.accessToken;
      refreshTokenCookie = cookies?.find((c: string) => c.startsWith('ucss_refresh_token=')) || '';
    });

    it('should reject registration if email is already taken', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('should reject registration if password does not meet complexity rules', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `weak_${Date.now()}@ucss.dev`,
          password: 'weak',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration if email is invalid', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: testPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should log in successfully with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.accessToken).toBeDefined();

      // Update access token
      accessToken = res.body.data.accessToken;
    });

    it('should reject login with wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject login for non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@ucss.dev',
          password: testPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return user profile and aggregated storage metrics with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.storage).toBeDefined();
      expect(res.body.data.storage.totalQuotaBytes).toBeDefined();
      expect(res.body.data.storage.totalUsedBytes).toBeDefined();
      expect(res.body.data.storage.activeAccountsCount).toBeTypeOf('number');
    });

    it('should reject request without Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request with invalid Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should issue a new access token using the refresh cookie', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', refreshTokenCookie);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(typeof res.body.data.accessToken).toBe('string');
    });

    it('should reject refresh without cookie or body', async () => {
      const res = await request(app).post('/api/auth/refresh');

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear refresh token cookie and return success', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.message).toBe('Logged out successfully');

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cleared = cookies?.some((c: string) => c.includes('ucss_refresh_token=;'));
      expect(cleared).toBe(true);
    });
  });
});
