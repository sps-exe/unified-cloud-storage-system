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

  constructor() {
    this.accessToken = localStorage.getItem('ucss_access_token');
  }

  setToken(token: string | null) {
    this.accessToken = token;
    if (token) {
      localStorage.setItem('ucss_access_token', token);
    } else {
      localStorage.removeItem('ucss_access_token');
    }
  }

  getToken(): string | null {
    return this.accessToken;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOnAuth = true,
  ): Promise<ApiSuccess<T>> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'include', // for HttpOnly refresh cookie
    });

    if (res.status === 401 && retryOnAuth && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/login')) {
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
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const body: ApiSuccess<{ accessToken: string }> = await res.json();
        if (body.ok && body.data.accessToken) {
          this.setToken(body.data.accessToken);
          return true;
        }
      }
      this.setToken(null);
      return false;
    } catch {
      this.setToken(null);
      return false;
    }
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
