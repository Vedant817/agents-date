/**
 * Integrity audit over a generated run file.
 *
 * Checks the properties the product claims, on real data rather than in unit
 * tests: every citation resolves, no turn refutes its own evidence, and
 * rankings are directed.
 *
 * Run: npx tsx scripts/audit-run.ts data/demo.json
 */
import { readFileSync } from "node:fs";
import type { PersonRecord, Run } from "../src/core/types";

const file = process.argv[2] ?? "data/demo.json";
const run = JSON.parse(readFileSync(file, "utf8")) as Run;

const lines = new Map<string, string[]>();
const traitKeys = new Map<string, Set<string>>();
for (const p of run.people) {
  const a = p.analysis;
  if (!a) continue;
  lines.set(p.id, [...(a.sources.linkedin.lines ?? []), ...(a.sources.instagram.lines ?? [])]);
  traitKeys.set(p.id, new Set(a.traits.map((t) => t.key)));
}

let citations = 0;
let unresolved = 0;
let missingPerson = 0;
let selfClaimViolations = 0;
let sharedGroundUncited = 0;

const seenSessions = new Set<string>();

for (const p of run.people) {
  for (const s of p.sessions ?? []) {
    if (seenSessions.has(s.id)) continue;
    seenSessions.add(s.id);

    for (const turn of s.turns) {
      const speaker = turn.role === "A" ? s.personAId : s.personBId;
      const about = turn.role === "A" ? s.personBId : s.personAId;

      for (const e of turn.evidence) {
        citations += 1;
        if (!e.personId) {
          missingPerson += 1;
          continue;
        }
        const owned = lines.get(e.personId);
        if (!owned || !owned.includes(e.quote)) unresolved += 1;
      }

      // "X shows T, and I have no evidence of it on your side."
      // The speaker is talking ABOUT the other person, so the cited evidence
      // must belong to that other person, and T must genuinely be absent
      // from the speaker's own traits.
      if (/no evidence of it on your side/.test(turn.text)) {
        const wrongSide = turn.evidence.filter((e) => e.personId === speaker).length;
        if (wrongSide > 0) selfClaimViolations += 1;
      }

      // "Both profiles actually show this" must cite both sides.
      if (turn.move === "shared_ground") {
        const people = new Set(turn.evidence.map((e) => e.personId));
        const speakerTraits = traitKeys.get(speaker) ?? new Set<string>();
        const aboutTraits = traitKeys.get(about) ?? new Set<string>();
        const trulyShared = [...speakerTraits].filter((k) => aboutTraits.has(k));
        if (people.size < 2 && trulyShared.length > 0) sharedGroundUncited += 1;
      }
    }
  }
}

// Directed ranking: count exact A==B ties across all ordered pairs.
const scores = new Map<string, number>();
for (const p of run.people) {
  for (const m of p.matches ?? []) scores.set(`${p.id}|${m.candidateId}`, m.overall);
}
let compared = 0;
let ties = 0;
for (const key of scores.keys()) {
  const [a, b] = key.split("|");
  const rev = `${b}|${a}`;
  if (!scores.has(rev) || key > rev) continue;
  compared += 1;
  if (scores.get(key) === scores.get(rev)) ties += 1;
}

// Traits with no evidence anywhere.
let unevidencedTraits = 0;
for (const p of run.people) {
  for (const t of p.analysis?.traits ?? []) if (t.evidence.length === 0) unevidencedTraits += 1;
}

// A trait whose own quote negates it in the SAME CLAUSE is a claim the
// citation refutes. Scope must match taxonomy.ts exactly, otherwise
// "Craft beer after the game, never before." is wrongly flagged -- the
// negation is in a different clause and the trait is genuine.
const NEG_CUES = [
  "hate", "hates", "hated", "dislike", "dislikes", "never", "no", "not", "isnt",
  "cant", "cannot", "wont", "avoid", "avoids", "against", "quit", "stopped",
  "used to", "former", "gave up", "anti", "uninterested", "allergic",
  "allergies", "intolerant", "zero", "none", "without", "except", "scraped",
  "deleted",
];
function quoteRefutesTrait(quote: string, traitKey: string): boolean {
  const label = (traitKey.split(":")[1] ?? "").replace(/-/g, " ");
  const lower = quote.toLowerCase();
  const idx = lower.indexOf(label.split(" ")[0] ?? label);
  if (idx === -1) return false;
  const before = lower.slice(0, idx);
  const lastBreak = Math.max(
    before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("."),
    before.lastIndexOf(" but "), before.lastIndexOf(" though "), before.lastIndexOf(" although "),
  );
  const clause = lower.slice(lastBreak + 1, idx + label.length);
  const words = clause.split(/[^a-z]+/).filter(Boolean);
  const firstTraitWord = (label.split(" ")[0] ?? label).toLowerCase();
  return words.some((w) => w !== firstTraitWord && NEG_CUES.includes(w));
}
let negatedTraits = 0;
for (const p of run.people) {
  for (const t of p.analysis?.traits ?? []) {
    if (t.evidence.some((e) => quoteRefutesTrait(e.quote, t.key))) negatedTraits += 1;
  }
}

// "Adds something new" must not claim emptiness when the candidate does add
// something. Match ONLY the empty-case sentence, not the "is new to you" one.
const byId = new Map(run.people.map((p) => [p.id, p]));
let additiveChecked = 0;
let additiveFalse = 0;
for (const p of run.people) {
  const mine = new Set((p.analysis?.traits ?? []).map((t) => t.key));
  for (const m of p.matches ?? []) {
    const c = m.components?.find((x) => x.label === "Adds something new");
    if (!c) continue;
    additiveChecked += 1;
    const theirs = (byId.get(m.candidateId)?.analysis?.traits ?? []).map((t) => t.key);
    const actuallyNew = theirs.filter((k) => !mine.has(k)).length;
    if (/something you already have/i.test(c.detail) && actuallyNew > 0) additiveFalse += 1;
  }
}

// Sessions must carry the real runId, not a placeholder.
const sessionRunIds = new Set<string>();
const seenSessions2 = new Set<string>();
for (const p of run.people) {
  for (const s of p.sessions ?? []) {
    if (seenSessions2.has(s.id)) continue;
    seenSessions2.add(s.id);
    sessionRunIds.add(s.runId);
  }
}
const badRunIds = [...sessionRunIds].filter((r) => r !== run.id);

// Placeholder names must never reach a transcript.
let unnamedTurns = 0;
for (const p of run.people) {
  for (const s of p.sessions ?? []) {
    for (const t of s.turns) if (/Unnamed/.test(t.text)) unnamedTurns += 1;
  }
}

const pct = (n: number, d: number) => (d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`);

console.log(`run: ${file}`);
console.log(`people: ${run.people.length}, sessions: ${seenSessions.size}`);
console.log(`--- evidence integrity ---`);
console.log(`turn citations:            ${citations}`);
console.log(`missing personId:          ${missingPerson}`);
console.log(`unresolvable quote:        ${unresolved}`);
console.log(`one-sided claim w/ wrong citation: ${selfClaimViolations}`);
console.log(`shared-ground citing one side:      ${sharedGroundUncited}`);
console.log(`traits with no evidence:   ${unevidencedTraits}`);
console.log(`traits refuted by own quote:${negatedTraits}`);
console.log(`additive claims checked:   ${additiveChecked}, false: ${additiveFalse}`);
console.log(`sessions with wrong runId: ${badRunIds.length}`);
console.log(`turns leaking 'Unnamed':   ${unnamedTurns}`);
console.log(`--- ranking ---`);
console.log(`ordered pairs compared:    ${compared}`);
console.log(`exact symmetric ties:      ${ties} (${pct(ties, compared)})`);

const failures = [
  ["missing personId", missingPerson],
  ["unresolvable quote", unresolved],
  ["one-sided claim mis-cited", selfClaimViolations],
  ["shared-ground under-cited", sharedGroundUncited],
  ["unevidenced trait", unevidencedTraits],
  ["trait refuted by its own quote", negatedTraits],
  ["false 'adds nothing' claim", additiveFalse],
  ["wrong session runId", badRunIds.length],
  ["turn leaking 'Unnamed'", unnamedTurns],
] as const;

const bad = failures.filter(([, n]) => n > 0);
if (bad.length > 0) {
  console.log(`\nFAIL: ${bad.map(([k, n]) => `${k}=${n}`).join(", ")}`);
  process.exit(1);
}
console.log("\nPASS: all evidence resolves and no turn contradicts its own citation.");
