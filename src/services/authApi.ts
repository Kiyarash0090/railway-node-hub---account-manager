export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  username?: string;
  token?: string;
}

const TOKEN_KEY = 'railway_hub_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
  } catch {}
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/**
 * Robust fetch wrapper that attaches Authorization: Bearer <token> and credentials: 'include'.
 * Does not mutate window.fetch to avoid "Cannot set property fetch of #<Window> which has only a getter".
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const opts: RequestInit = init ? { ...init } : {};
  const headers = new Headers(
    opts.headers || (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).headers : {})
  );

  if (token) {
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('x-hub-token')) {
      headers.set('x-hub-token', token);
    }
  }

  if (!opts.credentials) {
    opts.credentials = 'include';
  }
  opts.headers = headers;

  // Call native fetch
  const res = await (typeof window !== 'undefined' ? window.fetch(input, opts) : fetch(input, opts));

  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

  if (
    res.status === 401 &&
    !rawUrl.includes('/api/auth/login') &&
    !rawUrl.includes('/api/auth/setup') &&
    !rawUrl.includes('/api/auth/status')
  ) {
    clearStoredToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hub:session_expired'));
    }
  }

  return res;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await apiFetch('/api/auth/status');
  if (!res.ok) throw new Error('Failed to fetch auth status');
  return res.json();
}

export async function setupAuth(
  username: string,
  password: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  const res = await apiFetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) {
    const data = await res.json();
    if (data.token) {
      setStoredToken(data.token);
    }
    return { success: true, token: data.token };
  }
  return { success: false, error: await readError(res, 'Failed to create account') };
}

export async function loginAuth(
  username: string,
  password: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) {
    const data = await res.json();
    if (data.token) {
      setStoredToken(data.token);
    }
    return { success: true, token: data.token };
  }
  return { success: false, error: await readError(res, 'نام کاربری یا رمز عبور اشتباه است') };
}

export async function resetAuth(): Promise<{ success: boolean; error?: string }> {
  clearStoredToken();
  const res = await apiFetch('/api/auth/reset', { method: 'POST' });
  if (res.ok) return { success: true };
  return { success: false, error: await readError(res, 'Failed to reset auth') };
}

export async function logoutAuth(): Promise<void> {
  clearStoredToken();
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
}
