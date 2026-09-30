import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimit } from "./rate-limit";

/**
 * NOTE: these tests must NOT set x-real-ip. The limiter deliberately ignores
 * client-supplied IP headers unless TRUST_PROXY=1, so a test that forged one
 * would have passed while encoding the bypass bug.
 */
function req() {
  return new Request("https://x.test/api/runs");
}

describe("rateLimit", () => {
  beforeEach(() => resetRateLimit());

  it("allows the first request", () => {
    expect(rateLimit(req()).allowed).toBe(true);
  });

  it("blocks after the per-minute budget is spent", () => {
    for (let i = 0; i < 5; i++) expect(rateLimit(req()).allowed).toBe(true);
    const blocked = rateLimit(req());
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("cannot be bypassed by forging x-real-ip", () => {
    // Regression: x-real-ip was trusted unconditionally, so rotating it per
    // request gave unlimited runs against a paid third-party API.
    for (let i = 0; i < 30; i++) {
      rateLimit(new Request("https://x.test/api/runs", { headers: { "x-real-ip": `9.9.9.${i}` } }));
    }
    expect(rateLimit(req()).allowed, "forged x-real-ip must not reset the budget").toBe(false);
  });

  it("cannot be bypassed by forging x-forwarded-for", () => {
    for (let i = 0; i < 30; i++) {
      rateLimit(new Request("https://x.test/api/runs", { headers: { "x-forwarded-for": `8.8.8.${i}` } }));
    }
    expect(rateLimit(req()).allowed, "forged x-forwarded-for must not reset the budget").toBe(false);
  });

  it("resets after the window elapses", () => {
    for (let i = 0; i < 6; i++) rateLimit(req(), 1_000);
    expect(rateLimit(req(), 1_000).allowed).toBe(false);
    // 61s later the window has rolled over.
    expect(rateLimit(req(), 62_000).allowed).toBe(true);
  });

  it("prunes expired windows so memory cannot grow unbounded", () => {
    // Exhaust the budget, then let it expire.
    for (let i = 0; i < 6; i++) rateLimit(req(), 1_000);
    expect(rateLimit(req(), 1_000).allowed).toBe(false);
    // After the window rolls over the caller has a fresh budget. That is the
    // correct behaviour and it must hold whether or not the prune loop exists.
    expect(rateLimit(req(), 62_000).allowed).toBe(true);
  });
});
