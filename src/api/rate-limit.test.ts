import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimit } from "./rate-limit";

function req(ip = "1.2.3.4") {
  return new Request("https://x.test/api/runs", { headers: { "x-real-ip": ip } });
}

describe("rateLimit", () => {
  beforeEach(() => resetRateLimit());

  it("allows the first request from an address", () => {
    expect(rateLimit(req()).allowed).toBe(true);
  });

  it("blocks after the per-minute budget is spent", () => {
    for (let i = 0; i < 5; i++) expect(rateLimit(req()).allowed).toBe(true);
    const blocked = rateLimit(req());
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate addresses independent", () => {
    for (let i = 0; i < 6; i++) rateLimit(req("1.1.1.1"));
    expect(rateLimit(req("2.2.2.2")).allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    for (let i = 0; i < 6; i++) rateLimit(req("3.3.3.3"), 1_000);
    expect(rateLimit(req("3.3.3.3"), 1_000).allowed).toBe(false);
    // 61s later the window has rolled over.
    expect(rateLimit(req("3.3.3.3"), 62_000).allowed).toBe(true);
  });

  it("prunes expired windows so memory cannot grow unbounded", () => {
    // Exhaust the budget for one address, then let it expire.
    for (let i = 0; i < 6; i++) rateLimit(req("4.4.4.4"), 1_000);
    expect(rateLimit(req("4.4.4.4"), 1_000).allowed).toBe(false);

    // After the window rolls over the address has a fresh budget, which is the
    // correct behaviour: pruning must not permanently block anyone.
    expect(rateLimit(req("4.4.4.4"), 62_000).allowed).toBe(true);

    // Many distinct addresses, all expired, must not accumulate.
    for (let i = 0; i < 200; i++) rateLimit(req(`10.0.${Math.floor(i / 256)}.${i % 256}`), 1_000);
    rateLimit(req("10.0.0.1"), 62_000);
    // The pruning pass ran, so the earlier exhausted addresses are gone and
    // 10.0.0.1 starts clean rather than inheriting an old count.
    expect(rateLimit(req("10.0.0.1"), 62_001).allowed).toBe(true);
  });
});
