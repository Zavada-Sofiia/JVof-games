import type { AuthResponse } from '@jvof/shared';

let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let onAuthChange: (r: AuthResponse | null) => void = () => {};

export const getAccessToken = () => accessToken;
export const setAuthListener = (fn: (r: AuthResponse | null) => void) => (onAuthChange = fn);

export function setSession(r: AuthResponse | null) {
  accessToken = r?.accessToken ?? null;
  onAuthChange(r);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Оновити access-токен через httpOnly-cookie. Паралельні виклики чекають один запит. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (res) => (res.ok ? ((await res.json()) as AuthResponse) : null))
    .catch(() => null)
    .then((r) => {
      setSession(r);
      return r;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const doFetch = () =>
    fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, 'network', 'Немає зв’язку із сервером');
  }
  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await doFetch();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Помилка запиту');
  return data as T;
}
