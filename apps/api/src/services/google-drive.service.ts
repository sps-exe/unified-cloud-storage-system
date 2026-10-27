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

export const ROOT_FOLDER_NAME = '_UCSS_ROOT_';

export function isTokenRevokedError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('invalid_grant') ||
    msg.includes('token has been expired or revoked') ||
    msg.includes('unauthorized') ||
    msg.includes('bad credentials')
  );
}

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
      const quotaLimitBytes = quota?.limit ? BigInt(quota.limit) : BigInt(15 * 1024 * 1024 * 1024);
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
        quotaLimitBytes: q?.limit ? BigInt(q.limit) : BigInt(15 * 1024 * 1024 * 1024),
        quotaUsedBytes: q?.usage ? BigInt(q.usage) : BigInt(0),
        usageInDrive: q?.usageInDrive ? BigInt(q.usageInDrive) : BigInt(0),
        usageInTrash: q?.usageInDriveTrash ? BigInt(q.usageInDriveTrash) : BigInt(0),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch storage quota from Google Drive');
      throw new ExternalServiceError('Google Drive', 'Failed to fetch storage quota');
    }
  }

  /**
   * Finds or creates the dedicated UCSS root folder in the user's Drive.
   */
  private static async ensureRootFolder(driveClient: drive_v3.Drive): Promise<string> {
    try {
      const searchRes = await driveClient.files.list({
        q: `name = '${ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (searchRes.data.files && searchRes.data.files.length > 0) {
        return searchRes.data.files[0]!.id!;
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

      return createRes.data.id;
    } catch (error) {
      logger.error({ error }, 'Failed to ensure root folder');
      throw new ExternalServiceError('Google Drive', 'Failed to initialize root storage folder');
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
    body: stream.Readable | Buffer;
  }): Promise<{ driveFileId: string }> {
    try {
      const driveClient = this.getAuthenticatedClient(params.encryptedRefreshToken);
      const rootFolderId = params.rootFolderId || (await this.ensureRootFolder(driveClient));
      const res = await driveClient.files.create({
        requestBody: {
          name: params.filename,
          parents: [rootFolderId],
        },
        media: {
          mimeType: params.mimeType,
          body: Buffer.isBuffer(params.body) ? stream.Readable.from(params.body) : params.body,
        },
        fields: 'id, name, size',
      });

      if (!res.data.id) {
        throw new Error('Google Drive did not return file ID on creation');
      }

      return { driveFileId: res.data.id };
    } catch (error) {
      logger.error({ error, filename: params.filename }, 'Google Drive file upload failed');
      throw new ExternalServiceError('Google Drive', 'Failed to upload file to Google Drive');
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
      throw new ExternalServiceError('Google Drive', 'Failed to stream file from Google Drive');
    }
  }

  /**
   * Permanently deletes a file from Google Drive.
   * Used for cleaning up orphaned files after rollback or failures.
   */
  static async deleteFile(encryptedRefreshToken: string, driveFileId: string): Promise<void> {
    try {
      const driveClient = this.getAuthenticatedClient(encryptedRefreshToken);
      await driveClient.files.delete({ fileId: driveFileId });
      logger.info({ driveFileId }, 'Deleted file from Google Drive');
    } catch (error) {
      logger.warn({ error, driveFileId }, 'Failed to delete file from Google Drive during cleanup');
    }
  }
}
