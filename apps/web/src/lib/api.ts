// =============================================================================
// UCSS Web — API Client
// =============================================================================

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

class ApiClient {
  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('ucss_access_token');
      this.refreshTokenValue = localStorage.getItem('ucss_refresh_token');
    }
  }

  setToken(token: string | null) {
    this.accessToken = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('ucss_access_token', token);
      } else {
        localStorage.removeItem('ucss_access_token');
      }
    }
  }

  setRefreshToken(token: string | null) {
    this.refreshTokenValue = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('ucss_refresh_token', token);
      } else {
        localStorage.removeItem('ucss_refresh_token');
      }
    }
  }

  getToken(): string | null {
    if (!this.accessToken && typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('ucss_access_token');
    }
    return this.accessToken;
  }

  getRefreshToken(): string | null {
    if (!this.refreshTokenValue && typeof window !== 'undefined') {
      this.refreshTokenValue = localStorage.getItem('ucss_refresh_token');
    }
    return this.refreshTokenValue;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOnAuth = true,
  ): Promise<ApiSuccess<T>> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    const token = this.getToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'include', // for HttpOnly refresh cookie
    });

    if (res.status === 401 && retryOnAuth && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
      // Attempt token refresh
      const refreshed = await this.refreshToken();
      if (refreshed) {
        return this.request<T>(endpoint, options, false);
      }
    }

    const data: ApiResponse<T> = await res.json();
    if (!res.ok || !data.ok) {
      const err = (data as ApiError).error || {
        code: 'REQUEST_FAILED',
        message: `HTTP ${res.status} Error`,
      };
      throw new Error(err.message || 'Request failed');
    }

    return data as ApiSuccess<T>;
  }

  async refreshToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const storedRefreshToken = this.getRefreshToken();
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: storedRefreshToken ? JSON.stringify({ refreshToken: storedRefreshToken }) : undefined,
          credentials: 'include',
        });

        if (res.ok) {
          const body: ApiSuccess<{ accessToken: string; refreshToken?: string }> = await res.json();
          if (body.ok && body.data.accessToken) {
            this.setToken(body.data.accessToken);
            if (body.data.refreshToken) {
              this.setRefreshToken(body.data.refreshToken);
            }
            return true;
          }
        }

        // Only clear tokens if the refresh endpoint explicitly rejected them (401/403)
        if (res.status === 401 || res.status === 403) {
          this.setToken(null);
          this.setRefreshToken(null);
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }
}

export const api = new ApiClient();

export function formatBytes(bytesStr: string | number | bigint): string {
  try {
    const bytes = typeof bytesStr === 'bigint' ? Number(bytesStr) : Number(bytesStr);
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  } catch {
    return '0 B';
  }
}
