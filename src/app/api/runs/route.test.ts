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

  it("accepts the shipped example links and flags the run as sample data", async () => {
    // Regression: "Fill example" filled example-runner / example.runner, and
    // rejecting those made the one guided path on the start page a guaranteed
    // dead end. The run is now accepted and labelled instead.
    const res = await POST(
      post({
        entries: [
          {
            name: "Alex Rivera",
            linkedin: "linkedin.com/in/example-runner",
            instagram: "instagram.com/example.runner",
            linkedinText: "Alex Rivera\nRunner.",
            instagramText: "Alex Rivera\nRunner.",
          },
          {
            name: "Rowan Ellis",
            linkedin: "linkedin.com/in/example-designer",
            instagram: "instagram.com/example.designer",
            linkedinText: "Rowan Ellis\nDesigner.",
            instagramText: "Rowan Ellis\nDesigner.",
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.runId).toBe("string");

    const store = await getStore();
    const saved = await store.get(body.runId);
    expect(saved?.isSample, "example data must never be labelled as a real run").toBe(true);
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
