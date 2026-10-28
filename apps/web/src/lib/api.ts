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

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function resolveUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint;
  return `${API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

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

    const res = await fetch(resolveUrl(endpoint), {
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
        const res = await fetch(resolveUrl('/api/auth/refresh'), {
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
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  } catch {
    return '0 B';
  }
}

export interface PublicConfig {
  registrationOpen: boolean;
  firstRun: boolean;
  googleConfigured: boolean;
  googleRedirectUri: string;
  maxUploadBytes: number;
  webdavUrl: string;
}

/** POSTs multipart form data with upload progress (fetch can't report it). */
export function uploadWithProgress(
  endpoint: string,
  form: FormData,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', resolveUrl(endpoint));
    const token = api.getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onload = () => {
      let body: ApiResponse<unknown> | null = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) return resolve();
      reject(new Error((body && !body.ok && body.error.message) || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.send(form);
  });
}
