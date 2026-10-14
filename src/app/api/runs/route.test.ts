import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { resetRateLimit } from "@/api/rate-limit";
import { getStore } from "@/store/runs";

function post(body: unknown, contentType = "application/json") {
  return new Request("https://x.test/api/runs", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const person = (linkedin: string, instagram: string) => ({ linkedin, instagram });

describe("POST /api/runs validation", () => {
  it("rejects a non-JSON content type as 415 JSON", async () => {
    const res = await POST(post('{"entries":[]}', "text/plain"));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Send the run as JSON." });
  });

  it("names the missing body instead of a bare Required", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add at least one person.", issues: [] });
  });

  it("returns per-person issues for empty links", async () => {
    const res = await POST(post({ entries: [person("", "")] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    const fields = body.issues.map((i: { field: string }) => i.field).sort();
    expect(fields).toEqual(["instagram", "linkedin"]);
    expect(body.issues[0]).toMatchObject({ index: 0 });
  });

  it("creates a run from real links with pasted profile text", async () => {
    // The live path takes real user input only: two links per person plus the
    // visible profile text. No built-in personas exist anymore.
    const res = await POST(
      post({
        entries: [
          {
            name: "Ari Vance",
            linkedin: "linkedin.com/in/ari-vance",
            instagram: "instagram.com/ari.vance",
            linkedinText: "Ari Vance\nProduct engineer\nTrail running and bouldering at weekends.",
            instagramText: "Ari Vance\nRunner. Coffee obsessive.",
          },
          {
            name: "Bo Lindqvist",
            linkedin: "linkedin.com/in/bo-lindqvist",
            instagram: "instagram.com/bo.lindqvist",
            linkedinText: "Bo Lindqvist\nProduct designer\nTrail running and natural wine.",
            instagramText: "Bo Lindqvist\nTrail runner. Natural wine.",
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.runId).toBe("string");

    const store = await getStore();
    const saved = await store.get(body.runId);
    expect(saved?.people.length).toBe(2);
    expect(saved?.people.every((p) => p.status === "ready")).toBe(true);
    // Nothing in a live run is sample data: the flag no longer exists.
    expect(saved).not.toHaveProperty("isSample");
    expect(saved?.people.every((p) => !("isSample" in p))).toBe(true);
  });

  it("does not burn the rate budget on invalid requests", async () => {
    // Regression: the limiter ran before validation, so probing the form
    // with bad payloads could 429 a subsequent valid submit.
    resetRateLimit();
    for (let i = 0; i < 6; i++) {
      const res = await POST(post({ entries: [person("", "")] }));
      expect(res.status, `invalid request ${i + 1} must be rejected, not rate-limited`).toBe(400);
    }
  });

  it("enforces the 20-person cap", async () => {
    const entries = Array.from({ length: 21 }, (_, i) => person(`https://linkedin.com/in/p${i}`, `https://instagram.com/p${i}`));
    const res = await POST(post({ entries }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "20 people per run is the limit.", issues: [] });
  });
});

describe("other methods", () => {
  it("answers GET with JSON 405, not an empty status", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Use POST to create a run." });
  });
});
