import { describe, expect, it, beforeEach } from "vitest";
import { POST as extend } from "./route";
import { POST as create } from "../../route";
import { GET as getRun } from "../route";
import { resetRateLimit } from "@/api/rate-limit";
import { waitForRun } from "@/pipeline/background";
import { getStore } from "@/store/runs";

const LI = (n: string) => `linkedin.com/in/${n}`;
const IG = (n: string) => `instagram.com/${n}`;

/** Public profile text is what makes a person readable without a token. */
const text = (name: string) => ({
  linkedinText: [`${name} Example`, "Engineer at a scale-up", "Trail running and bouldering at weekends."].join("\n"),
  instagramText: [`${name} Example`, "Runner. Coffee obsessive.", "Six weeks to a sub-3 marathon."].join("\n"),
});

function withTrust(body: unknown): unknown {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return { consent: true, adult: true, ...body };
  }
  return body;
}

function post(url: string, body: unknown, contentType = "application/json") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(withTrust(body)),
  });
}

async function createRun(entries: unknown[]): Promise<string> {
  const res = await create(post("https://x.test/api/runs", { entries }));
  // 202: accepted, processing live. Tests await the in-process job instead
  // of holding the request open, exactly like the browser follows SSE.
  expect(res.status).toBe(202);
  const runId = ((await res.json()) as { runId: string }).runId;
  await waitForRun(runId);
  return runId;
}

async function extendRun(runId: string, entries: unknown[]): Promise<number> {
  const res = await extend(post(`https://x.test/api/runs/${runId}/people`, { entries }), {
    params: Promise.resolve({ runId }),
  });
  expect(res.status).toBe(202);
  await waitForRun(runId);
  return res.status;
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
    expect(res.status).toBe(202);
    await waitForRun(runId);

    const run = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const body = (await run.json()) as { run: { people: { linkedinUrl: string }[] } };
    expect(body.run.people.length).toBe(3);
  });

  it("leaves no placeholder ids in stored people, analyses or evidence", async () => {
    // Regression with user-visible damage: captures ran under tmp_1 ids and
    // the merge renamed only the record. Dates were planned for a phantom,
    // transcripts cited "this person" instead of a name, and the audit
    // failed on unresolvable quotes.
    const runId = await createRun([
      { linkedin: LI("a"), instagram: IG("a"), ...text("A") },
      { linkedin: LI("b"), instagram: IG("b"), ...text("B") },
    ]);
    const res = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("c"), instagram: IG("c"), ...text("C") }],
    }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(202);
    await waitForRun(runId);

    const run = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const body = (await run.json()) as {
      run: {
        people: {
          id: string;
          analysis?: {
            personId: string;
            traits: { evidence: { personId: string; quote: string }[] }[];
            needs: { evidence: { personId: string; quote: string }[] }[];
            openers: { evidence: { personId: string; quote: string }[] }[];
            sources: { linkedin: { lines?: string[] }; instagram: { lines?: string[] } };
          };
          sessions?: { personAId: string; personBId: string }[];
          matches?: { candidateId: string }[];
        }[];
      };
    };
    const ids = new Set(body.run.people.map((p) => p.id));
    expect([...ids].some((id) => id.startsWith("tmp_"))).toBe(false);
    for (const person of body.run.people) {
      expect(person.analysis?.personId, `${person.id} analysis points at its own record`).toBe(person.id);
      const lines = [
        ...(person.analysis?.sources.linkedin.lines ?? []),
        ...(person.analysis?.sources.instagram.lines ?? []),
      ];
      const evidence = [
        ...(person.analysis?.traits ?? []).flatMap((t) => t.evidence),
        ...(person.analysis?.needs ?? []).flatMap((n) => n.evidence),
        ...(person.analysis?.openers ?? []).flatMap((o) => o.evidence),
      ];
      for (const e of evidence) {
        expect(ids.has(e.personId), `evidence cites ${e.personId}, which is nobody in the run`).toBe(true);
        expect(lines, `quote resolves to a source line: ${e.quote}`).toContain(e.quote);
      }
      for (const s of person.sessions ?? []) {
        expect(ids.has(s.personAId) && ids.has(s.personBId), `session ${s.personAId}x${s.personBId} names run members`).toBe(true);
      }
      for (const m of person.matches ?? []) {
        expect(ids.has(m.candidateId), `ranking names ${m.candidateId}, who is nobody`).toBe(true);
      }
    }
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
    await waitForRun(runId);

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

  it("rejects a profile that is already in the run, in words a user can act on", async () => {
    const runId = await createRun([
      { linkedin: LI("a"), instagram: IG("a"), ...text("A") },
      { linkedin: LI("b"), instagram: IG("b"), ...text("B") },
    ]);

    // Regression: this is the resume path's own failure mode. It used to reply
    // "Same profile as entry -2", naming a person that does not exist and
    // giving the user no way to proceed.
    const res = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [
        { linkedin: LI("a"), instagram: IG("a"), ...text("A") },
        { linkedin: LI("b"), instagram: IG("b"), ...text("B") },
        { linkedin: LI("c"), instagram: IG("c"), ...text("C") },
      ],
    }), { params: Promise.resolve({ runId }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues).toBeUndefined();
    expect(body.error).toMatch(/already in this run/i);
    // The message must never reference a numbered "entry" that does not exist.
    expect(body.error).not.toMatch(/entry -?\d/i);
  });

  it("treats a case-variant of an existing profile as the same person", async () => {
    // LinkedIn and Instagram handles are case-insensitive, so a capitalised
    // paste is the same profile. It used to be accepted as a second person,
    // producing a run where an agent was dated against itself.
    const runId = await createRun([{ linkedin: LI("sturgeon"), instagram: IG("sturgeon"), ...text("S") }]);
    const res = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("Sturgeon"), instagram: IG("Sturgeon") }],
    }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already in this run/i);
  });

  it("refuses to extend the fixed showcase run", async () => {
    const res = await extend(post("https://x.test/api/runs/showcase/people", {
      entries: [{ linkedin: LI("z"), instagram: IG("z") }],
    }), { params: Promise.resolve({ runId: "showcase" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/showcase/i);
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
    expect(good.status).toBe(202);
    await waitForRun(runId);
  });
});

describe("live runs carry no sample labelling", () => {
  it("never flags a run or a person as sample data", async () => {
    resetRateLimit();
    // There is no sample path anymore: every run is built from user-submitted
    // links, so the sample flag must not appear anywhere in the stored run.
    const runId = await createRun([
      { linkedin: LI("ari-vance"), instagram: IG("ari.vance"), ...text("Ari") },
      { linkedin: LI("bo-lindqvist"), instagram: IG("bo.lindqvist"), ...text("Bo") },
    ]);

    const res = await extend(post(`https://x.test/api/runs/${runId}/people`, {
      entries: [{ linkedin: LI("cleo-marchetti"), instagram: IG("cleo.marchetti"), ...text("Cleo") }],
    }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(202);
    await waitForRun(runId);

    const run = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const body = (await run.json()) as {
      run: { people: Record<string, unknown>[] } & Record<string, unknown>;
    };
    expect(body.run).not.toHaveProperty("isSample");
    for (const person of body.run.people) {
      expect(person).not.toHaveProperty("isSample");
    }
    expect((body.run.notes as string[]).join(" ")).not.toMatch(/example personas/i);
  });
});

describe("concurrent extends do not lose a person", () => {
  it("keeps every person added by overlapping requests", async () => {
    resetRateLimit();
    // The read-then-save sequence used to sit outside the store's lock, so two
    // overlapping extends both minted p3, and the earlier one's person was
    // silently discarded while both requests were told 200.
    const runId = await createRun([
      { linkedin: LI("a"), instagram: IG("a"), ...text("A") },
      { linkedin: LI("b"), instagram: IG("b"), ...text("B") },
    ]);

    const before = Date.now();
    const [r1, r2] = await Promise.all([
      extend(post(`https://x.test/api/runs/${runId}/people`, {
        entries: [{ linkedin: LI("x"), instagram: IG("x"), ...text("X") }],
      }), { params: Promise.resolve({ runId }) }),
      extend(post(`https://x.test/api/runs/${runId}/people`, {
        entries: [{ linkedin: LI("y"), instagram: IG("y"), ...text("Y") }],
      }), { params: Promise.resolve({ runId }) }),
    ]);
    expect(Date.now() - before).toBeLessThan(60_000);
    // 202 is acceptance, not completion: both jobs merge under the run's lock,
    // so both people land with distinct ids.
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    await waitForRun(runId);

    const run = await getRun(new Request(`https://x.test/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const body = (await run.json()) as { run: { people: { linkedinUrl: string; id: string }[] } };
    const urls = body.run.people.map((p) => p.linkedinUrl);
    expect(urls).toContain("https://www.linkedin.com/in/a");
    expect(urls).toContain("https://www.linkedin.com/in/b");
    expect(urls).toContain("https://www.linkedin.com/in/x");
    expect(urls).toContain("https://www.linkedin.com/in/y");
    expect(body.run.people.length).toBe(4);
    // Distinct ids: the old bug minted p3 twice and lost one batch.
    expect(new Set(body.run.people.map((p) => p.id)).size).toBe(4);
  });
});
