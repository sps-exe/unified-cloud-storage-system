// =============================================================================
// UCSS API — Google Drive & OAuth Service
// =============================================================================
// Lightweight, ultra-fast Google Drive API interactions (v3) and OAuth 2.0.
// Powered by modular @googleapis/drive and google-auth-library (boots in ~50ms).
// 
// SECURITY PRINCIPLES:
//   - Scope: strictly 'https://www.googleapis.com/auth/drive.file' (least privilege).
//   - Refresh tokens are encrypted with AES-256-GCM before database insertion.
//   - State parameter contains signed/encrypted userId to defeat OAuth CSRF attacks.
//   - Automatic recovery: marks account TOKEN_EXPIRED if refresh token is revoked.
// =============================================================================

import { drive, type drive_v3 } from '@googleapis/drive';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../lib/env.js';
import { encryptToken, decryptToken } from '../lib/crypto.js';
import { AppError, UnauthorizedError, ExternalServiceError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';
import stream from 'node:stream';

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

// Google omits `limit` for unlimited Workspace plans; assume the free-tier size so allocation stays conservative.
const DEFAULT_QUOTA_BYTES = BigInt(15 * 1024 * 1024 * 1024);

export const ROOT_FOLDER_NAME = '_UCSS_ROOT_';

export function isTokenRevokedError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof AppError && error.code === 'TOKEN_EXPIRED') return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes('invalid_grant') || msg.includes('token has been expired or revoked');
}

/** Maps a raw Google error to TOKEN_EXPIRED (so callers can flag the account) or a generic 502. */
function driveError(error: unknown, fallback: string): AppError {
  if (isTokenRevokedError(error)) {
    return new AppError(401, 'TOKEN_EXPIRED', 'Google Drive access was revoked or expired. Reconnect the account.');
  }
  const reason = error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 200) : '';
  return new ExternalServiceError('Google Drive', reason ? `${fallback} (${reason})` : fallback);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Google throttles bursts (esp. many small uploads); these are worth retrying with backoff. */
function isTransientDriveError(error: unknown): boolean {
  const code = Number((error as { code?: number | string })?.code);
  const msg = (error instanceof Error ? error.message : '').toLowerCase();
  return [429, 500, 502, 503, 504].includes(code) || msg.includes('rate limit') || msg.includes('econnreset') || msg.includes('socket hang up');
}

const rootFolderCache = new Map<string, string>();

export interface OAuthCallbackResult {
  googleEmail: string;
  googleAccountId: string;
  encryptedRefreshToken: string;
  quotaLimitBytes: bigint;
  quotaUsedBytes: bigint;
  rootFolderId: string;
}

export class GoogleDriveService {
  /**
   * Creates an OAuth2 client configured with application credentials.
   */
  static getOAuth2Client(): OAuth2Client {
    if (!env.googleConfigured) {
      throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }
    return new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );
  }

  /**
   * Generates a tamper-proof state parameter encoding userId, timestamp, and nonce.
   */
  static generateState(userId: string): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const payload = JSON.stringify({ userId, timestamp, nonce });
    return encryptToken(payload);
  }

  /**
   * Validates and decrypts the OAuth state parameter, ensuring it matches within 10 minutes.
   */
  static verifyState(state: string): { userId: string } {
    try {
      const decrypted = decryptToken(state);
      const data = JSON.parse(decrypted) as { userId: string; timestamp: number };

      // State expires after 10 minutes
      if (Date.now() - data.timestamp > 10 * 60 * 1000) {
        throw new UnauthorizedError('OAuth state has expired. Please initiate connection again.');
      }

      return { userId: data.userId };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new UnauthorizedError('Invalid OAuth state parameter');
    }
  }

  /**
   * Generates the Google authorization URL for connecting a Drive account.
   */
  static getAuthorizationUrl(userId: string): string {
    const oauth2Client = this.getOAuth2Client();
    const state = this.generateState(userId);

    return oauth2Client.generateAuthUrl({
      access_type: 'offline', // CRITICAL: required to receive a refresh_token
      prompt: 'consent',     // CRITICAL: forces Google to issue a refresh_token even if previously granted
      scope: DRIVE_SCOPES,
      state,
      include_granted_scopes: true,
    });
  }

  /**
   * Exchanges authorization code for tokens, retrieves user profile and quota.
   */
  static async handleOAuthCallback(code: string): Promise<OAuthCallbackResult> {
    const oauth2Client = this.getOAuth2Client();

    try {
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens.refresh_token) {
        throw new ExternalServiceError(
          'Google OAuth',
          'No refresh token returned by Google. Ensure prompt=consent was used.',
        );
      }

      oauth2Client.setCredentials(tokens);

      // Query Drive quota and user identity via drive.about.get
      const driveClient = drive({ version: 'v3', auth: oauth2Client });
      const about = await driveClient.about.get({
        fields: 'storageQuota,user',
      });

      const user = about.data.user;
      const googleEmail = user?.emailAddress;
      const googleAccountId = user?.permissionId;

      if (!googleEmail || !googleAccountId) {
        throw new ExternalServiceError('Google OAuth', 'Unable to retrieve user identity from Google');
      }

      const quota = about.data.storageQuota;
      const quotaLimitBytes = quota?.limit ? BigInt(quota.limit) : DEFAULT_QUOTA_BYTES;
      const quotaUsedBytes = quota?.usage ? BigInt(quota.usage) : BigInt(0);

      // Ensure root folder '_UCSS_ROOT_' exists
      const rootFolderId = await this.ensureRootFolder(driveClient);

      return {
        googleEmail,
        googleAccountId,
        encryptedRefreshToken: encryptToken(tokens.refresh_token),
        quotaLimitBytes,
        quotaUsedBytes,
        rootFolderId,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to exchange Google OAuth code');
      if (error instanceof AppError) throw error;
      throw new ExternalServiceError('Google OAuth', 'Failed to complete Google OAuth exchange');
    }
  }

  /**
   * Instantiates an authenticated Google Drive client for an account.
   */
  static getAuthenticatedClient(encryptedRefreshToken: string): drive_v3.Drive {
    const refreshToken = decryptToken(encryptedRefreshToken);
    const oauth2Client = this.getOAuth2Client();

    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    return drive({ version: 'v3', auth: oauth2Client });
  }

  /**
   * Queries Google Drive storage quota via drive.about.get.
   */
  static async fetchStorageQuota(encryptedRefreshToken: string): Promise<{
    quotaLimitBytes: bigint;
    quotaUsedBytes: bigint;
    usageInDrive: bigint;
    usageInTrash: bigint;
  }> {
    const refreshToken = decryptToken(encryptedRefreshToken);

    try {
      const oauth2Client = this.getOAuth2Client();
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const driveClient = drive({ version: 'v3', auth: oauth2Client });
      const about = await driveClient.about.get({
        fields: 'storageQuota',
      });

      const q = about.data.storageQuota;
      return {
        quotaLimitBytes: q?.limit ? BigInt(q.limit) : DEFAULT_QUOTA_BYTES,
        quotaUsedBytes: q?.usage ? BigInt(q.usage) : BigInt(0),
        usageInDrive: q?.usageInDrive ? BigInt(q.usageInDrive) : BigInt(0),
        usageInTrash: q?.usageInDriveTrash ? BigInt(q.usageInDriveTrash) : BigInt(0),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch storage quota from Google Drive');
      throw driveError(error, 'Failed to fetch storage quota');
    }
  }

  /**
   * Finds or creates the dedicated UCSS root folder in the user's Drive.
   */
  private static async ensureRootFolder(driveClient: drive_v3.Drive, cacheKey?: string): Promise<string> {
    const cached = cacheKey ? rootFolderCache.get(cacheKey) : undefined;
    if (cached) return cached;
    try {
      const searchRes = await driveClient.files.list({
        q: `name = '${ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (searchRes.data.files && searchRes.data.files.length > 0) {
        const id = searchRes.data.files[0]!.id!;
        if (cacheKey) rootFolderCache.set(cacheKey, id);
        return id;
      }

      const createRes = await driveClient.files.create({
        requestBody: {
          name: ROOT_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder',
          description: 'Unified Cloud Storage System Root Folder. Do not delete.',
        },
        fields: 'id',
      });

      if (!createRes.data.id) {
        throw new Error('Google Drive failed to create root folder');
      }

      if (cacheKey) rootFolderCache.set(cacheKey, createRes.data.id);
      return createRes.data.id;
    } catch (error) {
      logger.error({ error }, 'Failed to ensure root folder');
      throw driveError(error, 'Failed to initialize root storage folder');
    }
  }

  /**
   * Uploads a file stream directly to the target Google Drive account inside _UCSS_ROOT_.
   * Returns the created Google Drive File ID.
   */
  static async uploadFile(params: {
    encryptedRefreshToken: string;
    rootFolderId?: string;
    filename: string;
    mimeType: string;
    /** A factory lets a failed attempt be retried with a fresh stream. */
    body: stream.Readable | Buffer | (() => stream.Readable);
  }): Promise<{ driveFileId: string }> {
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.uploadOnce(params);
      } catch (error) {
        const retryable = typeof params.body === 'function' && attempt < MAX_ATTEMPTS && isTransientDriveError((error as { cause?: unknown }).cause ?? error);
        if (!retryable) throw error;
        logger.warn({ attempt, filename: params.filename }, 'Transient Drive error; retrying upload');
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }

  private static async uploadOnce(params: {
    encryptedRefreshToken: string;
    rootFolderId?: string;
    filename: string;
    mimeType: string;
    body: stream.Readable | Buffer | (() => stream.Readable);
  }): Promise<{ driveFileId: string }> {
    try {
      const driveClient = this.getAuthenticatedClient(params.encryptedRefreshToken);
      const rootFolderId = params.rootFolderId || (await this.ensureRootFolder(driveClient, params.encryptedRefreshToken));
      const res = await driveClient.files.create({
        requestBody: {
          name: params.filename,
          parents: [rootFolderId],
        },
        media: {
          mimeType: params.mimeType,
          body: typeof params.body === 'function' ? params.body() : Buffer.isBuffer(params.body) ? stream.Readable.from(params.body) : params.body,
        },
        fields: 'id, name, size',
      });

      if (!res.data.id) {
        throw new Error('Google Drive did not return file ID on creation');
      }

      return { driveFileId: res.data.id };
    } catch (error) {
      logger.error({ error, filename: params.filename }, 'Google Drive file upload failed');
      rootFolderCache.delete(params.encryptedRefreshToken); // folder may have been deleted by the user
      const mapped = driveError(error, 'Failed to upload file to Google Drive');
      (mapped as { cause?: unknown }).cause = error; // lets the retry loop inspect the raw Google error
      throw mapped;
    }
  }

  /**
   * Streams a file from Google Drive for client download with optional byte range.
   */
  static async downloadFileStream(params: {
    encryptedRefreshToken: string;
    driveFileId: string;
    range?: string;
  }): Promise<stream.Readable> {
    try {
      const driveClient = this.getAuthenticatedClient(params.encryptedRefreshToken);
      const headers: Record<string, string> = {};
      if (params.range) {
        headers['Range'] = params.range;
      }
      const res = await driveClient.files.get(
        { fileId: params.driveFileId, alt: 'media' },
        { responseType: 'stream', headers },
      );
      return res.data as stream.Readable;
    } catch (error) {
      logger.error({ error, driveFileId: params.driveFileId }, 'Google Drive file download failed');
      throw driveError(error, 'Failed to stream file from Google Drive');
    }
  }

  /**
   * Permanently deletes a file from Google Drive (frees quota immediately; trash would not).
   * Returns false instead of throwing so callers can finish their DB bookkeeping.
   */
  static async deleteFile(encryptedRefreshToken: string, driveFileId: string): Promise<boolean> {
    try {
      const driveClient = this.getAuthenticatedClient(encryptedRefreshToken);
      await driveClient.files.delete({ fileId: driveFileId });
      logger.info({ driveFileId }, 'Deleted file from Google Drive');
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return true;
      logger.warn({ error, driveFileId }, 'Failed to delete file from Google Drive');
      return false;
    }
  }
}
