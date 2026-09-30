/**
 * Fixed-window in-memory rate limiter for the run-creation endpoint.
 *
 * Purpose: bound paid third-party spend. Each person in a run can trigger up
 * to two Apify captures, so an unauthenticated endpoint is a direct route to
 * spending the account's credits. This is intentionally simple and in-process;
 * it raises the cost of casual abuse, and is not a substitute for auth on a
 * paid deployment.
 */

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_RUNS_PER_WINDOW = Number(process.env.RATE_LIMIT_RUNS_PER_MINUTE ?? 5);

// Prune expired entries on every call so the map cannot grow unbounded.
const windows = new Map<string, Window>();

export interface RateResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(request: Request, now = Date.now()): RateResult {
  const key = clientKey(request);

  for (const [k, w] of windows) {
    if (w.resetAt <= now) windows.delete(k);
  }

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > MAX_RUNS_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function clientKey(request: Request): string {
  // Trust proxy headers only when explicitly configured, since they are
  // trivially spoofable when the app is exposed directly.
  if (process.env.TRUST_PROXY === "1") {
    const fwd = request.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
  }
  return request.headers.get("x-real-ip") ?? "anon";
}

/** Test hook: clears all windows. */
export function resetRateLimit(): void {
  windows.clear();
}
