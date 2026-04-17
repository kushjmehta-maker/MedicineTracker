import { useAuthStore } from '../store/authStore';

// =============================================================================
// API client
//
// Thin wrapper around fetch that:
//   • Attaches Authorization: Bearer <firebase_id_token> on every request
//   • Auto-refreshes the token on 401 (one retry)
//   • Throws ApiError with the server's error message on non-2xx
// =============================================================================

const BASE_URL = (__DEV__
  ? 'http://localhost:3000'
  : 'https://medicine-tracker-api-production.up.railway.app'
).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getToken(): Promise<string | null> {
  return useAuthStore.getState().idToken;
}

async function refreshAndGetToken(): Promise<string | null> {
  return useAuthStore.getState().refreshToken();
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = await getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    // Token may have expired — refresh once and retry
    const fresh = await refreshAndGetToken();
    if (fresh) return request<T>(method, path, body, false);
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      if (json.error) message = json.error;
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ── Typed helpers ─────────────────────────────────────────────────────────────

export const api = {
  get:    <T>(path: string) => request<T>('GET', path),
  post:   <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put:    <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch:  <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ── Domain-specific API calls ─────────────────────────────────────────────────

import type { Medicine, TodayDose, AdherenceProfile } from '../store/medicineStore';

export const medicinesApi = {
  list: () => api.get<Medicine[]>('/v1/medications'),

  create: (params: {
    name: string;
    dosageAmount: number;
    dosageUnit: string;
    frequencyType: Medicine['frequencyType'];
    reminderTimes: string[];
    color: string;
    icon: string;
    notes?: string;
    timezone: string;
  }) => api.post<Medicine>('/v1/medications', params),

  update: (id: string, params: Partial<Medicine>) =>
    api.patch<Medicine>(`/v1/medications/${id}`, params),

  delete: (id: string) => api.delete<void>(`/v1/medications/${id}`),
};

export const dosesApi = {
  today: () => api.get<TodayDose[]>('/v1/doses/today'),
  markTaken:   (instanceId: string) => api.post<void>(`/v1/doses/${instanceId}/taken`),
  markSkipped: (instanceId: string) => api.post<void>(`/v1/doses/${instanceId}/skip`),
  snooze: (instanceId: string, minutes: number) =>
    api.post<void>(`/v1/doses/${instanceId}/snooze`, { minutes }),
};

export const adherenceApi = {
  profile: () => api.get<AdherenceProfile>('/v1/adherence/profile'),
};

export const featuresApi = {
  all: () => api.get<Record<string, boolean>>('/v1/features'),
};

export const subscriptionApi = {
  current: () => api.get<{ planType: string; status: string } | null>('/v1/billing/subscription'),
  verifyReceipt: (receipt: { platform: 'ios' | 'android'; data: string; productId: string }) =>
    api.post('/v1/billing/receipt/verify', receipt),
};
