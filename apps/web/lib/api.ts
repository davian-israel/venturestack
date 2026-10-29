export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Server-side fetch to the API (public endpoints). */
export async function apiGet<T>(path: string, opts: { fresh?: boolean } = {}): Promise<T | null> {
  try {
    const res = await fetch(`${process.env.API_INTERNAL_URL ?? API}${path}`, opts.fresh ? { cache: 'no-store' } : { next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const KEY = 'vs_session';
export const session = {
  get(): string | null {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set(v: string) {
    try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};

/** Browser fetch with the session token. */
export async function authed<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.get() ?? ''}`, ...(init.headers ?? {}) },
  });
  let data: T | null = null;
  try { data = (await res.json()) as T; } catch { /* empty */ }
  return { status: res.status, data };
}
