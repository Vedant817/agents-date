import { describe, expect, it, beforeEach } from "vitest";
import { POST as extend } from "./route";
import { POST as create } from "../../route";
import { GET as getRun } from "../route";
import { resetRateLimit } from "@/api/rate-limit";
import { getStore } from "@/store/runs";
import { isSampleSubmission } from "@/pipeline/run";

const LI = (n: string) => `linkedin.com/in/${n}`;
const IG = (n: string) => `instagram.com/${n}`;

/** Public profile text is what makes a person readable without a token. */
const text = (name: string) => ({
  linkedinText: [`${name} Example`, "Engineer at a scale-up", "Trail running and bouldering at weekends."].join("\n"),
  instagramText: [`${name} Example`, "Runner. Coffee obsessive.", "Six weeks to a sub-3 marathon."].join("\n"),
});

function post(url: string, body: unknown, contentType = "application/json") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function createRun(entries: unknown[]): Promise<string> {
  const res = await create(post("https://x.test/api/runs", { entries }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

describe("POST /api/runs/<runId>/people (extend a run)", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("keeps the people already in the run and adds the new ones", async () => {
    const runId = await createRun([
      { linkedin: LI("a"), instagram: IG("a"), ...text("A") },
      { linkedin: LI("b"), instagram: IG("b"), ...text("B") },
    ]);

    const res = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("c"), instagram: IG("c"), ...text("C") }],
    }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(200);

    const run = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const body = (await run.json()) as { run: { people: { linkedinUrl: string }[] } };
    expect(body.run.people.length).toBe(3);
  });

  it("gives the original people the new dates and ranking entries", async () => {
    const runId = await createRun([
      { linkedin: LI("a"), instagram: IG("a"), ...text("A") },
      { linkedin: LI("b"), instagram: IG("b"), ...text("B") },
    ]);

    // Before extending, a two-person run has one date and one candidate each.
    const before = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const beforeRun = (await before.json()) as {
      run: { people: { sessions?: unknown[]; matches?: unknown[] }[] };
    };
    expect(beforeRun.run.people[0]!.matches!.length).toBe(1);
    const beforeSessions = beforeRun.run.people.flatMap((p) => p.sessions ?? []).length;

    await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("c"), instagram: IG("c"), ...text("C") }],
    }), { params: Promise.resolve({ runId }) });

    const after = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const afterRun = (await after.json()) as {
      run: { people: { sessions?: unknown[]; matches?: unknown[] }[] };
    };
    // The person who was already there now ranks two people, not one, and has
    // picked up the new date. Extending used to throw all of this away.
    expect(afterRun.run.people[0]!.matches!.length).toBe(2);
    const afterSessions = afterRun.run.people.flatMap((p) => p.sessions ?? []).length;
    expect(afterSessions).toBeGreaterThan(beforeSessions);
  });

  it("rejects a profile that is already in the run, so nobody is duplicated", async () => {
    const runId = await createRun([{ linkedin: LI("a"), instagram: IG("a"), ...text("A") }]);
    const res = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("a"), instagram: IG("a2") }],
    }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues[0].message).toMatch(/Same profile/);
  });

  it("refuses to extend the frozen demo run", async () => {
    const res = await extend(post("https://x.test/api/runs/demo/people", {
      entries: [{ linkedin: LI("z"), instagram: IG("z") }],
    }), { params: Promise.resolve({ runId: "demo" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/demo/i);
  });

  it("explains that the run is gone rather than creating a new one", async () => {
    const res = await extend(post("https://x.test/api/runs/run_missing/people", {
      entries: [{ linkedin: LI("a"), instagram: IG("a") }],
    }), { params: Promise.resolve({ runId: "run_missing" }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/does not exist or has expired/);
  });

  it("enforces the per-run cap across the whole run, not just the batch", async () => {
    const store = getStore();
    // Seed a run at the 20-person cap directly, so the test does not have to
    // create twenty captures.
    const people = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i + 1}`,
      runId: "run_full",
      displayName: `P${i}`,
      linkedinUrl: `https://www.linkedin.com/in/full${i}`,
      instagramUrl: `https://www.instagram.com/full${i}`,
      status: "ready" as const,
      createdAt: 1,
    }));
    await store.save({
      id: "run_full",
      isDemo: false,
      status: "complete",
      people,
      createdAt: 1,
      updatedAt: 1,
    });

    const res = await extend(post("https://x.test/api/runs/run_full/people", {
      entries: [{ linkedin: LI("more"), instagram: IG("more") }],
    }), { params: Promise.resolve({ runId: "run_full" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/20 people/);

    await store.delete("run_full");
  });

  it("does not spend rate-limit budget on a payload that cannot be used", async () => {
    // A bad payload is rejected before the limiter runs, so it cannot lock a
    // valid submit out. Same ordering guarantee the create route has.
    const runId = await createRun([{ linkedin: LI("a"), instagram: IG("a"), ...text("A") }]);
    for (let i = 0; i < 10; i++) {
      const bad = await extend(post(`https://x.test/api/runs/${runId}/people`, {
        entries: [{ linkedin: "", instagram: "" }],
      }), { params: Promise.resolve({ runId }) });
      expect(bad.status).toBe(400);
    }
    const good = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("b"), instagram: IG("b"), ...text("B") }],
    }), { params: Promise.resolve({ runId }) });
    expect(good.status).toBe(200);
  });
});

describe("sample labelling survives an extend", () => {
  it("still flags a run that mixes the built-in example with real people", async () => {
    resetRateLimit();
    // A run made only of example handles is a sample run.
    const sampleEntries = [
      { linkedin: LI("example-runner"), instagram: IG("example.runner") },
      { linkedin: LI("example-designer"), instagram: IG("example.designer") },
    ];
    expect(isSampleSubmission(sampleEntries)).toBe(true);
    const runId = await createRun(sampleEntries);

    const res = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("real-person"), instagram: IG("real.person") }],
    }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(200);

    const run = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const body = (await run.json()) as {
      run: { isSample?: boolean; people: { isSample?: boolean }[] };
    };
    expect(body.run.isSample).toBe(true);
    // Per person, not per run: the real person must not inherit the label.
    expect(body.run.people.filter((p) => p.isSample).length).toBe(2);
    expect(body.run.people.filter((p) => !p.isSample).length).toBe(1);
  });
});
