import { API_URL } from './config';
import { ApiRequestError } from './api';
import { useCustomerPortal } from './customerPortalStore';
import { ApiEnvelope } from './types';

export interface CustomerPortalRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function customerPortalApi<T = unknown>(path: string, opts: CustomerPortalRequestOptions = {}): Promise<T> {
  const { portalSessionToken, clearSession } = useCustomerPortal.getState();
  if (!portalSessionToken) throw new ApiRequestError('Portal session not found', 401);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/customer-portal${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-portal-token': portalSessionToken,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiRequestError('Network unavailable', 0, true);
  }

  let json: ApiEnvelope<T>;
  try {
    json = await res.json();
  } catch {
    throw new ApiRequestError(`Unexpected response (${res.status})`, res.status);
  }

  if (res.status === 401) {
    await clearSession();
    throw new ApiRequestError('Portal session expired. Please sign in again.', 401);
  }
  if (!res.ok || !json.success) throw new ApiRequestError(json.message ?? 'Portal request failed', res.status);
  return json.data;
}
