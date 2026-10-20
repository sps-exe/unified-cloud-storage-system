// =============================================================================
// UCSS — Shared Types
// Central location for types used across api and web packages.
// Any type used in both frontend and backend lives here.
// =============================================================================

// ─── Upload State Machine ────────────────────────────────────────────────────
// These mirror the PostgreSQL ENUMs exactly. Keep in sync with schema.prisma.

export type UploadStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ORPHANED'
  | 'CANCELLED';

export type AccountStatus =
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'TOKEN_EXPIRED'
  | 'QUOTA_EXCEEDED'
  | 'DISCONNECTED';

export type FileStatus = 'ACTIVE' | 'DELETED' | 'ORPHANED';

// ─── API Response Envelope ────────────────────────────────────────────────────
// Every API response wraps data in this shape for consistent frontend handling.

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;       // Machine-readable error code e.g. "QUOTA_EXCEEDED"
    message: string;    // Human-readable message — safe to display to users
    details?: unknown;  // Optional extra info for debugging (never sensitive)
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ─── Domain DTOs (Data Transfer Objects) ─────────────────────────────────────
// These are the shapes the API returns to the frontend.
// They intentionally omit sensitive fields (encrypted tokens, internal IDs).

export interface UserDto {
  id: string;
  email: string;
  createdAt: string; // ISO 8601
}

export interface DriveAccountDto {
  id: string;
  googleEmail: string;
  status: AccountStatus;
  quotaLimitBytes: string;         // bigint as string to avoid JS precision loss
  quotaUsedBytes: string;
  quotaAvailableBytes: string;
  reservedBytes: string;
  quotaLastSyncedAt: string | null;
  connectedAt: string;
  lastVerifiedAt: string | null;
}

export interface FileDto {
  id: string;
  driveAccountId: string;
  driveAccountEmail: string;
  originalFilename: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: string;               // bigint as string
  uploadStatus: UploadStatus;
  checksumSha256: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadOperationDto {
  id: string;
  fileId: string;
  driveAccountId: string;
  status: UploadStatus;
  retryCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

// ─── Storage Summary ─────────────────────────────────────────────────────────

export interface StorageSummaryDto {
  totalQuotaBytes: string;
  totalUsedBytes: string;
  totalAvailableBytes: string;
  totalReservedBytes: string;
  accountCount: number;
  activeAccountCount: number;
  fileCount: number;
}

// ─── Request / Query Parameter Types ─────────────────────────────────────────

export interface FileListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  mimeType?: string;
  driveAccountId?: string;
  sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}
