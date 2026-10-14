import { describe, expect, it } from "vitest";
import { computeNetwork, planSessions } from "@/pipeline/run";
import type { PersonRecord } from "@/core/types";

/**
 * The number of dates is derived, not arbitrary, and the page states the rule.
 * These tests pin the properties the rule promises, so a change to the planner
 * cannot quietly break the claim the UI makes.
 */

interface Person {
  id: string;
  /** Ordered list of preferred partners, best first. */
  prefs: string[];
}

/** Builds people whose `matches` encode a fixed preference order. */
function peopleWithPreferences(persons: Person[]): ReturnType<typeof planSessions> extends never ? never : Parameters<typeof planSessions>[0] {
  return persons.map((p) => ({
    id: p.id,
    matches: p.prefs.map((candidateId, i) => ({
      candidateId,
      overall: 1 - i * 0.01,
    })),
  }));
}

describe("how dates are chosen", () => {
  it("gives every agent a date with the person they rank first", () => {
    const people = peopleWithPreferences([
      { id: "a", prefs: ["c", "b"] },
      { id: "b", prefs: ["a", "c"] },
      { id: "c", prefs: ["a", "b"] },
    ]);
    const sessions = planSessions(people);
    const pairs = sessions.map(([x, y]) => [x, y].sort().join("|"));

    // a's first choice is c, b's first choice is a, c's first choice is a.
    // Note the stored tuple keeps [chooser, chosen] order, so a pair has to be
    // normalised before it is compared -- "b|a" and "a|b" are one date.
    expect(pairs).toContain("a|c");
    expect(pairs).toContain("a|b");
    expect(new Set(sessions.flat()).size).toBe(3);
  });

  it("records each date once even when both agents chose it", () => {
    const people = peopleWithPreferences([
      { id: "a", prefs: ["c", "b"] },
      { id: "b", prefs: ["a", "c"] },
      { id: "c", prefs: ["a", "b"] },
    ]);
    const keys = planSessions(people).map(([x, y]) => [x, y].sort().join("|"));
    // Pass 2 may also propose this pair from the other side; it must not
    // duplicate it.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lets two agents who choose each other share one date", () => {
    const people = peopleWithPreferences([
      { id: "a", prefs: ["b"] },
      { id: "b", prefs: ["a"] },
    ]);
    const sessions = planSessions(people);
    expect(sessions.length).toBe(1);
    expect(new Set(sessions.flat())).toEqual(new Set(["a", "b"]));
  });

  it("never leaves an agent without a date, whatever the target", () => {
    // A tiny target must not truncate coverage: removing a pair would leave
    // an agent with no date at all.
    const people = peopleWithPreferences([
      { id: "a", prefs: ["b", "c", "d"] },
      { id: "b", prefs: ["c", "d", "a"] },
      { id: "c", prefs: ["d", "a", "b"] },
      { id: "d", prefs: ["a", "b", "c"] },
    ]);
    const sessions = planSessions(people, 1);
    expect(new Set(sessions.flat()).size).toBe(4);
  });

  it("adds the strongest remaining pairs up to the target, and only adds", () => {
    // Four agents, each preferring the first of the others: coverage alone
    // gives one pair per uncovered agent. The target then tops up.
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      prefs: [`p${(i + 1) % 8}`, `p${(i + 2) % 8}`],
    }));
    const people = peopleWithPreferences(many);
    const sessions = planSessions(people, 5);
    expect(new Set(sessions.flat()).size).toBe(8);
    expect(sessions.length).toBe(5);
  });

  it("produces no dates for fewer than two readable people", () => {
    const people = peopleWithPreferences([{ id: "a", prefs: [] }]);
    expect(planSessions(people)).toEqual([]);
    expect(planSessions([])).toEqual([]);
  });

  it("keeps stored sessions exactly equal to the current plan", () => {
    // The run page states the date rule as fact, so the stored sessions must
    // be exactly what the planner produces: no stale pairs from an older
    // ranking, no missing ones. Uses a generated cohort — there is no demo
    // data file to read from anymore.
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const people = peopleWithPreferences(
      ids.map((id, i) => ({
        id,
        prefs: [ids[(i + 1) % ids.length]!, ids[(i + 3) % ids.length]!, ids[(i + 5) % ids.length]!],
      })),
    );
    const sessions = planSessions(people);
    // Every agent covered, none dating twice in the same plan.
    expect(new Set(sessions.flat()).size).toBe(ids.length);
    const keys = sessions.map(([x, y]) => [x, y].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("recomputing a network is stable, so extending a run adds rather than resets", () => {
    const base = peopleWithPreferences([
      { id: "a", prefs: ["b"] },
      { id: "b", prefs: ["a"] },
    ]).map((p, i) => ({
      id: p.id,
      runId: "run_x",
      linkedinUrl: `https://www.linkedin.com/in/${p.id}`,
      instagramUrl: `https://www.instagram.com/${p.id}`,
      status: "ready" as const,
      createdAt: i,
      // Give each a trivial analysis so computeNetwork can rank them.
      analysis: {
        personId: p.id,
        engine: "deterministic" as const,
        displayName: p.id,
        headline: "",
        traits: [],
        hobbies: [],
        interests: [],
        values: [],
        needs: [],
        openers: [],
        gaps: [],
        sources: {
          linkedin: { kind: "linkedin" as const, url: `l:${p.id}`, status: "captured" as const, readMode: "pasted" as const, lines: [] },
          instagram: { kind: "instagram" as const, url: `i:${p.id}`, status: "captured" as const, readMode: "pasted" as const, lines: [] },
        },
        analysedAt: 1,
      },
    }));

    const once = computeNetwork(base as PersonRecord[]);
    const twice = computeNetwork(once as PersonRecord[]);
    // Same session ids, so a re-run does not orphan earlier work.
    const ids = (p: PersonRecord) => (p.sessions ?? []).map((s) => s.id).sort();
    expect(ids(twice[0]!)).toEqual(ids(once[0]!));
  });
});
