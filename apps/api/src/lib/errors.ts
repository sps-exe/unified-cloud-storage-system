// =============================================================================
// UCSS API — Error Classes
// =============================================================================
// Custom error hierarchy. Errors carry HTTP status codes and machine-readable
// error codes. The global error handler uses these to produce consistent
// API responses without leaking internal details.

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    // Restore prototype chain (required when extending built-ins in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// 400 — Client sent invalid data
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

// 401 — Not authenticated
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

// 403 — Authenticated but not permitted
export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

// 404 — Resource not found
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

// 409 — Conflict (e.g., duplicate account)
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

// 507 — Insufficient storage (all accounts full)
export class QuotaExceededError extends AppError {
  constructor(message = 'No connected account has sufficient storage for this file') {
    super(507, 'QUOTA_EXCEEDED', message);
    this.name = 'QuotaExceededError';
  }
}

// 502 — External service error (Google Drive API failure)
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(502, 'EXTERNAL_SERVICE_ERROR', `${service}: ${message}`);
    this.name = 'ExternalServiceError';
  }
}
