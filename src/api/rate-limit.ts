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

/**
 * Parse the limit defensively. `Number("abc")` is NaN and `count > NaN` is
 * always false, so a typo in the env var would silently DISABLE the limiter --
 * the exact bug class guarded by parseCharge() in src/ingest/setup.ts.
 */
function parseLimit(raw: string | undefined): number {
  const n = Number(raw ?? 5);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(Math.floor(n), 1000);
}

const MAX_RUNS_PER_WINDOW = parseLimit(process.env.RATE_LIMIT_RUNS_PER_MINUTE);

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
  // Client-supplied IP headers are trivially forged, so they are only honoured
  // when the deployment sits behind a proxy that overwrites them. Trusting
  // them unconditionally let one header bypass the spend cap entirely.
  if (process.env.TRUST_PROXY === "1") {
    const fwd = request.headers.get("x-forwarded-for");
    if (fwd) return `xf:${fwd.split(",")[0]!.trim()}`;
    const real = request.headers.get("x-real-ip");
    if (real) return `ri:${real.trim()}`;
  }
  // Without a trusted proxy we cannot identify the caller, so every anonymous
  // request shares one budget. That is deliberately strict: it is a spend cap,
  // not an auth system.
  return "anon";
}

/** Test hook: clears all windows. */
export function resetRateLimit(): void {
  windows.clear();
}
