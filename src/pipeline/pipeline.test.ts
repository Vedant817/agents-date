import { describe, expect, it } from "vitest";
import { analyse } from "@/analysis/analyse";
import { runDate } from "@/dating/engine";
import { rankCandidates, scoreMatch, MATCH_WEIGHTS, MATCH_COMPONENTS } from "@/matching/rank";
import { computeNetwork, planSessions, summarise, validateSubmission, emptyRun } from "@/pipeline/run";
import { ConsentedTextAdapter } from "@/ingest/public";
import { normaliseInstagramUrl, normaliseLinkedInUrl, parseCharge } from "@/ingest/setup";
import { processPerson } from "@/pipeline/run";
import type { PersonRecord, SourceRecord } from "@/core/types";

function src(
  kind: "linkedin" | "instagram",
  lines: string[],
): SourceRecord {
  return { kind, url: `https://example.test/${kind}`, status: "captured", capturedAt: 1, lines, provider: "test" };
}

const TRAIL = [
  "Maya Okonkwo",
  "Senior Backend Engineer at Stripe",
  "Trail running, ultramarathons and open water swimming are how I decompress.",
  "Previously at Monzo. Skills: Go, Kubernetes, Postgres.",
  "Mentoring early-career engineers through a local programme.",
];

const CINEPHILE = [
  "Diego Ramirez",
  "Product Designer",
  "Film photography, arthouse cinema and natural wine are the whole personality.",
  "I shoot on a 35mm Contax and only drink natural wine.",
  "Volunteering at a community film festival most weekends.",
];

const CLIMBER = [
  "Priya Raman",
  "Data Scientist",
  "Bouldering four times a week. Also into espresso and pastry bakeries.",
  "New to the city and looking for climbing partners.",
];

function rec(id: string, a: PersonAnalysisLike, extra: Partial<PersonRecord> = {}): PersonRecord {
  return {
    id,
    runId: "r",
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    instagramUrl: `https://www.instagram.com/${id}`,
    status: "ready",
    createdAt: 1,
    analysis: a as never,
    ...extra,
  };
}

type PersonAnalysisLike = ReturnType<typeof analyse>;

describe("analyse", () => {
  it("only cites traits that appear in the sources", () => {
    const a = analyse("p1", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) });
    for (const t of a.traits) {
      expect(t.evidence.length, `${t.key} must have evidence`).toBeGreaterThan(0);
      for (const e of t.evidence) {
        const lines = e.source === "linkedin" ? TRAIL : CINEPHILE;
        expect(lines[e.line ?? -1]).toBe(e.quote);
      }
    }
  });

  it("detects hobbies from both sources", () => {
    const a = analyse("p1", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) });
    const keys = a.traits.map((t) => t.key);
    expect(keys).toContain("hobby:trail-running");
    expect(keys).toContain("hobby:photography");
    expect(keys).toContain("interest:wine");
  });

  it("derives needs only from evidenced traits", () => {
    const a = analyse("p1", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) });
    const keys = new Set(a.traits.map((t) => t.key));
    for (const n of a.needs) {
      expect(keys.has(n.derivedFromTraitKey), `need ${n.key} has no backing trait`).toBe(true);
      expect(n.evidence.length).toBeGreaterThan(0);
    }
  });

  it("reports gaps instead of inventing personal attributes", () => {
    const a = analyse("p1", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) });
    const joined = a.gaps.join(" ").toLowerCase();
    expect(joined).toContain("age");
    expect(joined).toContain("orientation");
  });

  it("prefers the LinkedIn name over a shortened Instagram name", () => {
    // Regression: Instagram display names are routinely shortened. The
    // professional record of a name should win, or profiles read as "Amara"
    // when the person is "Amara Okonkwo".
    const a = analyse("p1", {
      linkedin: src("linkedin", ["Amara Okonkwo", "Backend engineer"]),
      instagram: src("instagram", ["Amara", "Runner. Coffee first."]),
    });
    expect(a.displayName).toBe("Amara Okonkwo");
  });

  it("falls back to the Instagram name when LinkedIn is unreadable", () => {
    const a = analyse("p1", {
      linkedin: { kind: "linkedin", url: "u", status: "unavailable", reason: "blocked" },
      instagram: src("instagram", ["Amara", "Runner. Coffee first."]),
    });
    expect(a.displayName).toBe("Amara");
  });

  it("survives an unreadable source and still analyses the other", () => {    const a = analyse("p1", {
      linkedin: src("linkedin", TRAIL),
      instagram: { kind: "instagram", url: "u", status: "unavailable", reason: "blocked" },
    });
    expect(a.traits.length).toBeGreaterThan(0);
    expect(a.gaps.join(" ")).toMatch(/only one of the two sources/i);
  });

  it("does not crash when both sources are empty", () => {
    const a = analyse("p1", {
      linkedin: { kind: "linkedin", url: "u", status: "unavailable", reason: "x" },
      instagram: { kind: "instagram", url: "u", status: "unavailable", reason: "y" },
    });
    expect(a.traits).toHaveLength(0);
    expect(a.needs).toHaveLength(0);
  });

  it("raises confidence when both sources corroborate a trait", () => {
    const both = analyse("p", {
      linkedin: src("linkedin", ["I love climbing weekly."]),
      instagram: src("instagram", ["Bouldering, bouldering, bouldering every week."]),
    });
    const climbing = both.traits.find((t) => t.key === "hobby:climbing");
    expect(climbing).toBeDefined();
    const sources = new Set(climbing!.evidence.map((e) => e.source));
    expect(sources.size).toBe(2);
    expect(climbing!.confidence).toBeGreaterThan(0.85);
  });

  it("does not let repetition alone raise confidence", () => {
    // Regression: repeat mentions added +0.04 each, so a keyword-stuffed bio
    // reached 0.99 and outranked a substantive profile by 27 points.
    // Both personas here mention the trait on ONE source only, so the only
    // difference is repetition.
    const single = (lines: string[]) =>
      analyse("x", { linkedin: src("linkedin", lines), instagram: src("instagram", ["Person", "Nothing here."]) });

    const honest = single(["A Person", "Trail running at sunrise."]);
    const spam = single([
      "B Person",
      "Trail running.",
      "Trail running.",
      "Trail running.",
      "Trail running.",
      "Trail running.",
      "Trail running.",
      "Trail running.",
      "Trail running.",
    ]);
    const h = honest.traits.find((t) => t.key === "hobby:trail-running")!;
    const s = spam.traits.find((t) => t.key === "hobby:trail-running")!;
    expect(s.confidence).toBe(h.confidence);
  });
});

describe("ranking", () => {
  const a = analyse("a", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) });
  const c = analyse("c", { linkedin: src("linkedin", CLIMBER), instagram: src("instagram", CINEPHILE) });

  it("is directed, not symmetric", () => {
    const ab = scoreMatch(a, c);
    const ca = scoreMatch(c, a);
    expect(ab.personId).toBe("a");
    expect(ca.personId).toBe("c");
    // A real directional difference must exist for people with different needs.
    // The previous assertion (only fails when both are exactly 0) was vacuous:
    // a perfect non-zero tie satisfied it.
    expect(ab.overall).not.toBe(ca.overall);
  });

  it("never produces an exactly symmetric score for differing profiles", () => {
    // Measured on the demo cohort, 23.7% of pairs tied exactly, which made
    // "directed" an overstatement. Values overlap is now asymmetric.
    const trail = analyse("t1", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) });
    const climb = analyse("c1", { linkedin: src("linkedin", CLIMBER), instagram: src("instagram", CINEPHILE) });
    expect(scoreMatch(trail, climb).overall).not.toBe(scoreMatch(climb, trail).overall);
  });

  it("ranks a shared-activity candidate higher than a disjoint one", () => {
    const runner = analyse("r", { linkedin: src("linkedin", ["Trail running every weekend."]), instagram: src("instagram", ["Trail running and hiking."]) });
    const disjoint = analyse("d", { linkedin: src("linkedin", ["Auditing and financial reporting."]), instagram: src("instagram", ["Reading spreadsheets."]) });
    const withRunner = scoreMatch(runner, a);
    const withDisjoint = scoreMatch(runner, disjoint);
    expect(withRunner.overall).toBeGreaterThan(withDisjoint.overall);
  });

  it("excludes self from the ranking", () => {
    const list = rankCandidates(a, [a, c]);
    expect(list.map((m) => m.candidateId)).not.toContain("a");
    expect(list).toHaveLength(1);
  });

  it("produces exactly n-1 candidates for a full pool", () => {
    const pool = Array.from({ length: 25 }, (_, i) =>
      analyse(`p${i}`, { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) }),
    );
    const ranked = rankCandidates(pool[0]!, pool);
    expect(ranked).toHaveLength(24);
  });

  it("is deterministic across runs", () => {
    const pool = [a, c];
    expect(rankCandidates(a, pool).map((m) => m.candidateId)).toEqual(
      rankCandidates(a, pool).map((m) => m.candidateId),
    );
  });

  it("sorts descending and stays in 0..1", () => {
    const pool = [a, c];
    const r = rankCandidates(a, pool);
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.overall).toBeGreaterThanOrEqual(r[i]!.overall);
    for (const m of r) {
      expect(m.overall).toBeGreaterThanOrEqual(0);
      expect(m.overall).toBeLessThanOrEqual(1);
    }
  });

  it("always explains itself with components", () => {
    const m = scoreMatch(a, c);
    expect(m.components.length).toBeGreaterThanOrEqual(3);
    for (const comp of m.components) expect(comp.detail.length).toBeGreaterThan(5);
  });

  it("does not say a candidate adds nothing when they do add something", () => {
    // CRITICAL regression: the bucket was `${category}:${keyPrefix}`, which put
    // EVERY hobby in one bucket, so a candidate who climbs but does not run
    // was told "Everything they show is something you already have too".
    const runner = analyse("r9", { linkedin: src("linkedin", ["A Person", "Trail running."]), instagram: src("instagram", ["A", "Runner."]) });
    const climber = analyse("c9", { linkedin: src("linkedin", ["B Person", "Bouldering weekly."]), instagram: src("instagram", ["B", "Climber."]) });
    const m = scoreMatch(runner, climber);
    const additive = m.components.find((c) => c.label === "Adds something new")!;
    expect(additive.detail, "climbing is not running").not.toMatch(/everything they show is something you already have/i);
    expect(additive.score).toBeGreaterThan(0);
    expect(additive.evidence.length, "an additive claim must be cited").toBeGreaterThan(0);
  });

  it("publishes weights that sum to 1 and match the component list", () => {
    const total = Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(MATCH_COMPONENTS.length).toBe(Object.keys(MATCH_WEIGHTS).length);
    for (const c of MATCH_COMPONENTS) {
      expect(MATCH_WEIGHTS[c.key], `${c.key} weight must match the exported value`).toBe(c.weight);
    }
  });

  it("gives every match the same components the method page documents", () => {
    const m = scoreMatch(a, c);
    const labels = m.components.map((c) => c.label).sort();
    const documented = MATCH_COMPONENTS.map((c) => c.label).sort();
    expect(labels, "the UI must not show a component the docs do not describe").toEqual(documented);
  });
});

describe("dating", () => {
  const a = analyse("a", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) });
  const c = analyse("c", { linkedin: src("linkedin", CLIMBER), instagram: src("instagram", CINEPHILE) });
  const d = analyse("d", { linkedin: src("linkedin", ["Auditor at a Big Four firm."]), instagram: src("instagram", ["Spreadsheets and crosswords."]) });

  it("produces a conversation with both agents speaking", () => {
    const s = runDate("r", a, c);
    expect(s.turns.filter((t) => t.role === "A").length).toBeGreaterThan(1);
    expect(s.turns.filter((t) => t.role === "B").length).toBeGreaterThan(1);
  });

  it("cites evidence on most turns", () => {
    const s = runDate("r", a, c);
    const cited = s.turns.filter((t) => t.evidence.length > 0).length;
    expect(cited / s.turns.length).toBeGreaterThan(0.25);
  });

  it("names the shared ground when there is one", () => {
    const s = runDate("r", a, c);
    expect(s.turns.some((t) => t.move === "shared_ground")).toBe(true);
  });

  it("agrees the verb with the number of shared traits", () => {
    // Regression: the summary hardcoded "are", so a single shared trait
    // produced "wine are verifiable on both sides" on the live site.
    const solo = analyse("s1", {
      linkedin: src("linkedin", ["Only natural wine here."]),
      instagram: src("instagram", ["Wine."]),
    });
    const other = analyse("s2", {
      linkedin: src("linkedin", ["Natural wine only for me."]),
      instagram: src("instagram", ["Wine."]),
    });
    const one = runDate("r", solo, other).turns.filter((t) => /verifiable/.test(t.text));
    expect(one.length).toBeGreaterThan(0);
    for (const t of one) expect(t.text, "one shared trait needs 'is'").toMatch(/\bis verifiable\b/);

    const pairA = analyse("p1", {
      linkedin: src("linkedin", ["Wine and climbing."]),
      instagram: src("instagram", ["Wine, climbing, espresso."]),
    });
    const pairB = analyse("p2", {
      linkedin: src("linkedin", ["Wine and climbing."]),
      instagram: src("instagram", ["Wine, climbing, hiking."]),
    });
    const two = runDate("r", pairA, pairB).turns.filter((t) => /verifiable/.test(t.text));
    expect(two.length).toBeGreaterThan(0);
    for (const t of two) expect(t.text, "two shared traits need 'are'").toMatch(/\bare verifiable\b/);
  });

  it("admits a mismatch when there is no overlap", () => {
    const s = runDate("r", a, d);
    expect(s.turns.some((t) => t.move === "mismatch")).toBe(true);
    expect(s.evaluation?.sharedGround ?? 1).toBeLessThan(0.3);
  });

  it("ends with both agents reflecting", () => {
    const s = runDate("r", a, c);
    const lastTwo = s.turns.slice(-2);
    expect(lastTwo.every((t) => t.move === "reflection")).toBe(true);
    expect(lastTwo.map((t) => t.role).sort()).toEqual(["A", "B"]);
  });

  it("has strictly increasing sequence numbers", () => {
    const s = runDate("r", a, c);
    s.turns.forEach((t, i) => expect(t.seq).toBe(i));
  });

  it("is deterministic", () => {
    const s1 = runDate("r", a, c);
    const s2 = runDate("r", a, c);
    expect(s1.turns.map((t) => t.text)).toEqual(s2.turns.map((t) => t.text));
  });

  it("never cites a shared trait while claiming it is one-sided", () => {
    // Regression: the curiosity turn used to fall back to shared[0] and say
    // "I have no evidence of it on your side" while quoting B's own line.
    // A = only climbing, B = climbing + wine.
    const onlyA = analyse("a2", { linkedin: src("linkedin", ["A Person", "Bouldering weekly."]), instagram: src("instagram", ["Climber."]) });
    const both = analyse("b2", { linkedin: src("linkedin", ["B Person", "Bouldering and natural wine."]), instagram: src("instagram", ["B", "Climbing and wine."]) });

    const session = runDate("r", onlyA, both);
    for (const turn of session.turns) {
      if (!/no evidence of it on your side/.test(turn.text)) continue;
      // The cited quote must come from A, and A must NOT have the trait.
      const bKeys = new Set(both.traits.map((t) => t.key));
      const aKeys = new Set(onlyA.traits.map((t) => t.key));
      const cited = [...aKeys].filter((k) => bKeys.has(k));
      expect(cited.length, "a 'no evidence on your side' claim must cite a trait B lacks").toBe(0);
    }
  });

  it("gives every cited turn a resolvable personId", () => {
    // Regression: 50% of transcript evidence could not be resolved because
    // Evidence had no personId, so a turn quoting the other person looked like
    // it was quoting its own.
    const ids = new Set([a.personId, c.personId]);
    const session = runDate("r", a, c);
    for (const turn of session.turns) {
      for (const e of turn.evidence) {
        expect(ids.has(e.personId), `evidence "${e.quote.slice(0, 30)}" has no known personId`).toBe(true);
      }
    }
  });

  it("cites both sides when claiming both profiles show something", () => {
    const session = runDate("r", a, c);
    const sharedTurn = session.turns.find((t) => t.move === "shared_ground");
    expect(sharedTurn).toBeDefined();
    const people = new Set(sharedTurn!.evidence.map((e) => e.personId));
    expect(people.size, "a 'both profiles show X' claim must cite both people").toBe(2);
  });

  it("cites the traits it enumerates when there is no overlap", () => {
    // Regression: the "we share nothing" turn listed up to six real traits
    // with evidence: [], naming facts a reader could not check. The audit
    // script cannot catch a missing citation, so assert it here.
    const runner = analyse("r7", { linkedin: src("linkedin", ["A Person", "Trail running, natural wine."]), instagram: src("instagram", ["A", "Runner."]) });
    const gamer = analyse("g7", { linkedin: src("linkedin", ["B Person", "Board games and comics."]), instagram: src("instagram", ["B", "Gamer."]) });
    const session = runDate("r", runner, gamer);
    for (const turn of session.turns) {
      if (!/share no activity at all/.test(turn.text)) continue;
      expect(turn.evidence.length, "a turn enumerating real traits must cite them").toBeGreaterThan(0);
    }
  });

  it("never calls a person 'Unnamed' in the transcript", () => {
    const anon = analyse("anon", { linkedin: src("linkedin", ["Backend engineer"]), instagram: src("instagram", ["Runner."]) });
    const other = analyse("o8", { linkedin: src("linkedin", ["Real Name", "Cycling."]), instagram: src("instagram", ["Real", "Cycling."]) });
    const session = runDate("r", anon, other);
    for (const turn of session.turns) {
      expect(turn.text, "transcript must not leak the placeholder name").not.toMatch(/Unnamed/);
    }
  });

  it("uses a submitted name over text parsed from the profile", () => {
    // Regression: pasting bio-first text made the bio the display name, and
    // with no typed name the person became "Unnamed profile".
    const withName = analyse("n1", {
      linkedin: src("linkedin", ["Trail running, bouldering and natural wine fill my weekends."]),
      instagram: src("instagram", ["Coffee first."]),
    }, "Jordan Blake");
    expect(withName.displayName).toBe("Jordan Blake");
  });

  it("scores a shared-activity date above a disjoint one", () => {
    const good = runDate("r", a, c);
    const bad = runDate("r", a, d);
    expect(good.evaluation!.overall).toBeGreaterThan(bad.evaluation!.overall);
  });
});

describe("planSessions", () => {
  it("covers every agent in a 25-person pool", () => {
    const people = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`,
      matches: [{ candidateId: `p${(i + 1) % 25}`, overall: 0.9 - i * 0.01 }],
    }));
    const plan = planSessions(people, 14);
    const covered = new Set(plan.flat());
    expect(covered.size).toBe(25);
  });

  it("never pairs a person with themselves", () => {
    const people = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      matches: [{ candidateId: `p${(i + 1) % 8}`, overall: 0.5 }],
    }));
    for (const [a, b] of planSessions(people, 6)) expect(a).not.toBe(b);
  });

  it("does not duplicate a pair", () => {
    const people = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      matches: [
        { candidateId: `p${(i + 1) % 6}`, overall: 0.8 },
        { candidateId: `p${(i + 2) % 6}`, overall: 0.7 },
      ],
    }));
    const plan = planSessions(people, 8);
    const keys = plan.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("computeNetwork", () => {
  it("gives every ready person a full ranking and at least one date", () => {
    const people = Array.from({ length: 25 }, (_, i) =>
      rec(`p${i}`, analyse(`p${i}`, { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) })),
    );
    const out = computeNetwork(people);
    for (const p of out) {
      expect(p.matches, `${p.id} ranking`).toHaveLength(24);
      expect((p.sessions ?? []).length, `${p.id} sessions`).toBeGreaterThan(0);
    }
  });

  it("leaves failed people without a ranking rather than crashing", () => {
    const good = rec("p0", analyse("p0", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) }));
    const bad: PersonRecord = {
      id: "p1", runId: "r", linkedinUrl: "l", instagramUrl: "i", status: "failed", error: "nope", createdAt: 1,
    };
    const out = computeNetwork([good, bad]);
    expect(out.find((p) => p.id === "p1")!.matches).toHaveLength(0);
    expect(out.find((p) => p.id === "p0")!.matches).toHaveLength(0);
    expect(out).toHaveLength(2);
  });

  it("never ranks or dates a person whose sources were unreadable", () => {
    // Regression: a ghost with no readable source was a full ranking candidate
    // and a date partner, rendered as "Unknown".
    const a = rec("p0", analyse("p0", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) }));
    const b = rec("p1", analyse("p1", { linkedin: src("linkedin", CLIMBER), instagram: src("instagram", CINEPHILE) }));
    const ghost: PersonRecord = {
      id: "p2", runId: "r", linkedinUrl: "l", instagramUrl: "i", status: "failed", error: "unreadable", createdAt: 1,
    };
    const out = computeNetwork([a, b, ghost]);
    for (const p of out) {
      const ids = (p.matches ?? []).map((m) => m.candidateId);
      expect(ids, `${p.id} must not rank the unreadable person`).not.toContain("p2");
    }
    const sessionIds = out.flatMap((p) => (p.sessions ?? []).flatMap((s) => [s.personAId, s.personBId]));
    expect(sessionIds, "the unreadable person must not be in any date").not.toContain("p2");
  });

  it("excludes self from its own shortlist", () => {
    const a = rec("p0", analyse("p0", { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) }));
    const b = rec("p1", analyse("p1", { linkedin: src("linkedin", CLIMBER), instagram: src("instagram", CINEPHILE) }));
    const out = computeNetwork([a, b]);
    for (const p of out) {
      expect((p.matches ?? []).map((m) => m.candidateId), `${p.id} ranked itself`).not.toContain(p.id);
    }
  });
});

describe("validateSubmission", () => {
  it("accepts a clean pair", () => {
    expect(validateSubmission([{ linkedin: "https://linkedin.com/in/a", instagram: "https://instagram.com/b" }])).toHaveLength(0);
  });

  it("rejects a company page", () => {
    const issues = validateSubmission([{ linkedin: "https://linkedin.com/company/x", instagram: "https://instagram.com/b" }]);
    expect(issues[0]?.field).toBe("linkedin");
  });

  it("rejects a duplicate profile", () => {
    const issues = validateSubmission([
      { linkedin: "https://linkedin.com/in/a", instagram: "https://instagram.com/b" },
      { linkedin: "https://linkedin.com/in/a", instagram: "https://instagram.com/c" },
    ]);
    expect(issues.some((i) => i.message.includes("Same profile"))).toBe(true);
  });
});

describe("processPerson (consented text, no network)", () => {
  it("analyses a person from supplied text", async () => {
    const adapter = new ConsentedTextAdapter();
    adapter.supply("linkedin", "https://www.linkedin.com/in/maya", TRAIL.join("\n"));
    adapter.supply("instagram", "https://www.instagram.com/maya", CINEPHILE.join("\n"));
    const p = await processPerson(
      "r",
      { linkedin: "https://linkedin.com/in/maya", instagram: "https://instagram.com/maya" },
      [adapter],
      "maya",
    );
    expect(p.status).toBe("ready");
    expect(p.analysis!.traits.length).toBeGreaterThan(0);
  });

  it("records a readable failure when nothing can be read", async () => {
    const p = await processPerson(
      "r",
      { linkedin: "https://linkedin.com/in/nobody", instagram: "https://instagram.com/nobody" },
      [new ConsentedTextAdapter()],
      "x",
    );
    expect(p.status).toBe("failed");
    expect(p.error).toMatch(/apify|paste/i);
    // A failed person must not carry an analysis into the dating pool.
    expect(p.analysis).toBeUndefined();
  });

  it("accepts pasted text for every accepted URL form", async () => {
    // Regression: pasted text was keyed by a loose regex while lookup used the
    // strict parser, so bare handles, @handles and instagr.am silently missed
    // and the user was told to paste text they had already pasted.
    const forms = [
      "williamhgates",
      "https://www.linkedin.com/in/williamhgates",
      "https://www.linkedin.com/in/williamhgates/",
    ];
    for (const linkedin of forms) {
      const adapter = new ConsentedTextAdapter();
      adapter.supply("linkedin", normaliseLinkedInUrl(linkedin), "Bill Gates\nCo-chair of a foundation.\nGolf and reading.");
      adapter.supply("instagram", normaliseInstagramUrl("https://instagram.com/billgates"), "Bill\nGolf and books.");
      const p = await processPerson("r", { linkedin, instagram: "https://instagram.com/billgates" }, [adapter], "b");
      expect(p.status, `LinkedIn form: ${linkedin}`).toBe("ready");
      expect(p.analysis!.traits.length, `LinkedIn form: ${linkedin}`).toBeGreaterThan(0);
    }
  });

  it("accepts pasted text for bare and @ Instagram handles", async () => {
    for (const instagram of ["nasa", "@nasa", "https://www.instagram.com/nasa/", "https://instagr.am/nasa"]) {
      const adapter = new ConsentedTextAdapter();
      adapter.supply("linkedin", normaliseLinkedInUrl("https://linkedin.com/in/billgates"), "Bill Gates\nCo-chair.\nCoffee and cycling.");
      adapter.supply("instagram", normaliseInstagramUrl(instagram), "Bill\nCoffee, cycling, natural wine.");
      const p = await processPerson("r", { linkedin: "https://linkedin.com/in/billgates", instagram }, [adapter], "b");
      expect(p.status, `Instagram form: ${instagram}`).toBe("ready");
    }
  });
});

describe("summarise", () => {  it("counts people and unique sessions", () => {
    const run = emptyRun("r", false);
    const people = Array.from({ length: 3 }, (_, i) =>
      rec(`p${i}`, analyse(`p${i}`, { linkedin: src("linkedin", TRAIL), instagram: src("instagram", CINEPHILE) })),
    );
    const computed = computeNetwork(people);
    run.people = computed;
    const s = summarise(run);
    expect(s.total).toBe(3);
    expect(s.ready).toBe(3);
    expect(s.sessions).toBeGreaterThan(0);
  });
});
