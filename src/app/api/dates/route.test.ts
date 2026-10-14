import { describe, expect, it, beforeEach } from "vitest";
import { POST as dates, GET as datesGet } from "./route";
import { POST as create } from "../runs/route";
import { resetRateLimit } from "@/api/rate-limit";
import { waitForRun } from "@/pipeline/background";

function post(body: unknown, contentType = "application/json") {
  return new Request("https://x.test/api/dates", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const text = (name: string) => ({
  linkedinText: [`${name} Example`, "Engineer at a scale-up", "Trail running and bouldering at weekends."].join("\n"),
  instagramText: [`${name} Example`, "Runner. Coffee obsessive.", "Six weeks to a sub-3 marathon."].join("\n"),
});

async function createRun(): Promise<string> {
  const res = await create(
    new Request("https://x.test/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entries: [
          { linkedin: "linkedin.com/in/a", instagram: "instagram.com/a", ...text("A") },
          { linkedin: "linkedin.com/in/b", instagram: "instagram.com/b", ...text("B") },
          { linkedin: "linkedin.com/in/c", instagram: "instagram.com/c", ...text("C") },
        ],
      }),
    }),
  );
  expect(res.status).toBe(202);
  const runId = ((await res.json()) as { runId: string }).runId;
  await waitForRun(runId);
  return runId;
}

describe("POST /api/dates (instant date)", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("dates any two ready people with the deterministic engine", async () => {
    const runId = await createRun();
    const res = await dates(post({ runId, a: "p1", b: "p3" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { personAId: string; personBId: string; turns: unknown[]; evaluation: { overall: number } };
    };
    expect(body.session.personAId).toBe("p1");
    expect(body.session.personBId).toBe("p3");
    expect(body.session.turns.length).toBeGreaterThan(0);
    expect(body.session.evaluation.overall).toBeGreaterThan(0);
  });

  it("dates the showcase cohort, or says plainly that none exists", async () => {
    // The showcase is a real consented run read from a committed file. Until
    // volunteers contribute one, the endpoint must say so — nothing synthetic
    // may stand in for it. Either way the test asserts real behavior.
    const { existsSync } = await import("node:fs");
    const { default: path } = await import("node:path");
    const res = await dates(post({ runId: "showcase", a: "p1", b: "p2" }));
    if (!existsSync(path.join(process.cwd(), "data", "showcase.json"))) {
      expect(res.status).toBe(500);
      expect((await res.json()).error).toMatch(/could not be loaded/i);
      return;
    }
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { turns: unknown[] } };
    expect(body.session.turns.length).toBeGreaterThan(0);
  });

  it("refuses to date someone against themselves", async () => {
    const runId = await createRun();
    const res = await dates(post({ runId, a: "p1", b: "p1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/different people/i);
  });

  it("refuses people who are not in the run", async () => {
    const runId = await createRun();
    const res = await dates(post({ runId, a: "p1", b: "p99" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not in this run/i);
  });

  it("answers a missing run with 404", async () => {
    const res = await dates(post({ runId: "run_missing", a: "p1", b: "p2" }));
    expect(res.status).toBe(404);
  });

  it("names the missing pick instead of a bare Required", async () => {
    const res = await dates(post({ runId: "x", a: "", b: "" }));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });

  it("rejects a non-JSON content type as 415 JSON", async () => {
    const res = await dates(post('{"runId":"x"}', "text/plain"));
    expect(res.status).toBe(415);
  });

  it("answers other methods with JSON 405", async () => {
    expect((await datesGet()).status).toBe(405);
  });
});
