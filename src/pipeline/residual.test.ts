import { describe, expect, it } from "vitest";
import { computeNetwork, summarise } from "@/pipeline/run";
import type { PersonRecord, Run } from "@/core/types";

/**
 * Residual-defect checks on the parts the last QA round could not reach.
 * These pin properties that must survive refactors of the merge and the
 * session planning, so a future change cannot quietly break them.
 */

function person(id: string, opts: { analysis?: boolean; status?: "ready" | "failed" } = {}): PersonRecord {
  const { analysis = true, status = "ready" } = opts;
  return {
    id,
    runId: "run_probe",
    displayName: `Person ${id}`,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    instagramUrl: `https://www.instagram.com/${id}`,
    status,
    ...(analysis
      ? {
          analysis: {
            personId: id,
            engine: "deterministic" as const,
            displayName: `Person ${id}`,
            headline: `Person ${id} headline`,
            traits: [],
            hobbies: [],
            interests: [],
            values: [],
            needs: [],
            openers: [],
            gaps: [],
            sources: {
              linkedin: { kind: "linkedin" as const, url: `l:${id}`, status: "captured" as const, readMode: "pasted" as const, lines: [] },
              instagram: { kind: "instagram" as const, url: `i:${id}`, status: "captured" as const, readMode: "pasted" as const, lines: [] },
            },
            analysedAt: 1,
          },
        }
      : {}),
    createdAt: 1,
  };
}

describe("computeNetwork is idempotent for sessions", () => {
  it("re-running it produces the same sessions, so extending is stable", () => {
    const people = [person("a"), person("b"), person("c"), person("d")];
    const once = computeNetwork(people);
    const twice = computeNetwork(once);

    const ids = (p: PersonRecord) => (p.sessions ?? []).map((s) => s.id).sort();
    for (const p of once) {
      const before = ids(p);
      const after = ids(twice.find((q) => q.id === p.id)!);
      expect(after).toEqual(before);
    }
  });

  it("keeps only sessions whose pair still exists in the run", () => {
    // REPLACE, not union: a session for a pair that has left the run must not
    // linger. This is what made an extended run claim 28 dates while stating a
    // 14-date rule.
    const people = [person("a"), person("b"), person("c"), person("d"), person("e")];
    const net = computeNetwork(people);

    const personIds = new Set(net.map((p) => p.id));
    for (const p of net) {
      for (const s of p.sessions ?? []) {
        expect(personIds.has(s.personAId)).toBe(true);
        expect(personIds.has(s.personBId)).toBe(true);
      }
    }
    // And no duplicate session ids within one person.
    for (const p of net) {
      const ids = (p.sessions ?? []).map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("drops a session when one of its people becomes unreadable", () => {
    const people = [person("a"), person("b"), person("c")];
    const first = computeNetwork(people);
    const withDates = first.find((p) => (p.sessions ?? []).length > 0);
    expect(withDates).toBeDefined();

    // Person b is now unreadable: any session involving b must go.
    const degraded = people.map((p) => (p.id === "b" ? person("b", { analysis: false, status: "failed" }) : p));
    const net = computeNetwork(degraded);
    for (const p of net) {
      for (const s of p.sessions ?? []) {
        expect(s.personAId).not.toBe("b");
        expect(s.personBId).not.toBe("b");
      }
    }
  });

  it("never attaches a session to a person who is not in it", () => {
    const people = Array.from({ length: 9 }, (_, i) => person(`p${i}`));
    const net = computeNetwork(people);
    for (const p of net) {
      for (const s of p.sessions ?? []) {
        const inIt = s.personAId === p.id || s.personBId === p.id;
        expect(inIt).toBe(true);
      }
    }
  });

  it("summarise counts each session once across both participants", () => {
    const people = [person("a"), person("b"), person("c")];
    const net = computeNetwork(people);
    const run: Run = {
      id: "run_probe",
      status: "complete",
      people: net,
      createdAt: 1,
      updatedAt: 1,
    };
    const s = summarise(run);
    // Every session is attached to two people; the count must not double.
    const unique = new Set(net.flatMap((p) => (p.sessions ?? []).map((x) => x.id)));
    expect(s.sessions).toBe(unique.size);
    expect(s.ready).toBe(3);
    expect(s.failed).toBe(0);
  });
});

describe("a run can be extended and recomputed without losing structure", () => {
  it("a person added later keeps their own ranking and dates", () => {
    const base = computeNetwork([person("a"), person("b")]);
    const extended = computeNetwork([...base, person("c")]);

    const a = extended.find((p) => p.id === "a")!;
    const c = extended.find((p) => p.id === "c")!;
    // The original person gains c as a candidate rather than being reset.
    expect(a.matches?.map((m) => m.candidateId)).toContain("c");
    // The new person ranks everyone else.
    expect(c.matches?.length).toBe(2);
    // And the original person's id and url are untouched.
    expect(a.id).toBe("a");
    expect(a.linkedinUrl).toBe("https://www.linkedin.com/in/a");
  });

  it("a person with no analysis never enters the pool", () => {
    const people = [person("a"), person("dead", { analysis: false, status: "failed" })];
    const net = computeNetwork(people);
    const a = net.find((p) => p.id === "a")!;
    expect(a.matches?.length ?? 0).toBe(0);
    expect(a.sessions?.length ?? 0).toBe(0);
  });
});
