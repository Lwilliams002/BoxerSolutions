import { API_URL } from './config';
import { useAuth } from './authStore';
import { ApiEnvelope } from './types';

export class ApiRequestError extends Error {
  status: number;
  retryable: boolean;
  data?: unknown;
  constructor(message: string, status: number, retryable = false, data?: unknown) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.data = data;
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { getRefreshToken, setTokens, logout } = useAuth.getState();
      const refresh = await getRefreshToken();
      if (!refresh) {
        await logout();
        return false;
      }
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          await logout();
          return false;
        }
        await setTokens(json.data.accessToken, json.data.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      setTimeout(() => (refreshPromise = null), 0);
    });
  }
  return refreshPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  retry?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { accessToken } = useAuth.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiRequestError('Network unavailable', 0, true);
  }

  if (res.status === 401 && opts.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) return api<T>(path, { ...opts, retry: false });
  }

  let json: ApiEnvelope<T> & { retryable?: boolean };
  try {
    json = await res.json();
  } catch {
    throw new ApiRequestError(`Unexpected response (${res.status})`, res.status);
  }
  if (!res.ok || !json.success) {
    throw new ApiRequestError(json.message ?? `Request failed (${res.status})`, res.status, json.retryable ?? res.status >= 500, json.data);
  }
  return json.data;
}

export function newIdempotencyKey(): string {
  // RFC4122-ish v4 without external deps
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
