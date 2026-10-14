import { analyse } from "@/analysis/analyse";
import { runDate } from "@/dating/engine";
import { rankCandidates } from "@/matching/rank";
import { parseInstagram, parseLinkedIn } from "@/core/urls";
import type { CaptureAdapter } from "@/ingest/adapter";
import { AnonymousWebAdapter, ConsentedTextAdapter } from "@/ingest/public";
import type {
  DateSession,
  Evidence,
  PersonAnalysis,
  PersonRecord,
  Run,
  SourceRecord,
} from "@/core/types";

/**
 * The committed showcase run: a REAL run built from consenting volunteers'
 * pasted profiles, stored at data/showcase.json. There is no synthetic data
 * anywhere in the product — no seed script, no invented personas. Until
 * volunteers contribute, /demo renders its empty state.
 */
export const SHOWCASE_RUN_ID = "showcase";

export interface PipelineDeps {
  readonly adapters: readonly CaptureAdapter[];
}

export function defaultAdapters(): CaptureAdapter[] {
  // Anonymous first: if a public page genuinely exposes text, use it.
  // Consented text is the credential-free fallback that always works.
  return [new AnonymousWebAdapter(), new ConsentedTextAdapter()];
}

export function newRunId(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `run_${stamp}${rand}`;
}

export function emptyRun(id: string, notes: string[] = []): Run {
  const now = Date.now();
  return {
    id,
    status: "created",
    people: [],
    createdAt: now,
    updatedAt: now,
    notes,
  };
}

export interface ValidationIssue {
  readonly index: number;
  readonly field: "linkedin" | "instagram" | "name";
  readonly message: string;
}

/** Validates a whole submission before any network work begins. */
export function validateSubmission(
  entries: readonly { linkedin?: string; instagram?: string; name?: string }[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenLinkedIn = new Map<string, number>();
  const seenInstagram = new Map<string, number>();

  entries.forEach((entry, index) => {
    const li = parseLinkedIn(entry.linkedin ?? "");
    if (!li.ok) {
      issues.push({ index, field: "linkedin", message: li.error ?? "Invalid LinkedIn URL." });
    } else {
      const prev = seenLinkedIn.get(li.url!);
      if (prev !== undefined) {
        issues.push({ index, field: "linkedin", message: `Same profile as entry ${prev + 1}. Each person needs their own LinkedIn.` });
      } else {
        seenLinkedIn.set(li.url!, index);
      }
    }

    const ig = parseInstagram(entry.instagram ?? "");
    if (!ig.ok) {
      issues.push({ index, field: "instagram", message: ig.error ?? "Invalid Instagram URL." });
    } else {
      const prev = seenInstagram.get(ig.url!);
      if (prev !== undefined) {
        issues.push({ index, field: "instagram", message: `Same profile as entry ${prev + 1}. Each person needs their own Instagram.` });
      } else {
        seenInstagram.set(ig.url!, index);
      }
    }
  });

  return issues;
}

/**
 * School-age cues that mark a profile as underage. The educator-word guard
 * applies to ALL of them uniformly: "middle school teacher" clears exactly
 * like "high school teacher" does, because the writer is the adult in the
 * room either way. Gating it per-label refused a middle-school teacher while
 * passing an identical secondary-school one.
 *
 * Senior years (grade 12, year 12, form 6) are included even though some
 * seniors are 18: on a dating product a missed minor is worse than a false
 * refusal the error message tells the user how to fix.
 *
 * KNOWN GAP: patterns are English, US/UK-leaning. Non-English school cues
 * pass silently. This backstop supports the 18+ attestation; it is not a
 * replacement for caring who gets submitted.
 */
const MINOR_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bhigh school (student|senior|junior|sophomore|freshman)\b/i, label: "high school student" },
  { pattern: /\bmiddle school\b/i, label: "middle school" },
  { pattern: /\bsecondary school\b/i, label: "secondary school" },
  { pattern: /\bclass of 20(2[7-9]|3\d)\b/i, label: "upcoming graduating class" },
  { pattern: /\bgrade (9|10|11|12)\b/i, label: "school grade" },
  { pattern: /\b(9|10|11|12)th grade\b/i, label: "school grade" },
  { pattern: /\byear (7|8|9|10|11|12)\b/i, label: "school year" },
  { pattern: /\bform (1|2|3|4|5|6)\b/i, label: "school form" },
  { pattern: /\bunder (1[0-7])\b/i, label: "underage" },
  { pattern: /\b(1[0-7]) years old\b/i, label: "underage" },
  { pattern: /\bin high school\b/i, label: "in high school" },
];

/** Words that mark the writer as the adult in the room, not the student. */
const EDUCATOR_WORDS =
  /\b(teacher|teaching|coach|coaching|mentor|mentoring|tutor|tutoring|professor|lecturer|graduated|alumni|reunion|principal)\b/i;

/**
 * Explicit enrollment beats the educator guard: "high school senior
 * tutoring freshmen" is a student with a job, not a teacher. Everything
 * else with an educator word clears.
 */
const STUDENT_STRONG =
  /\bhigh school (student|senior|junior|sophomore|freshman)\b|\b(high|middle) schoolers?\b/i;

/**
 * Returns the matched cue label when captured profile text reads as
 * school-age, else null. Runs on captured lines only — never on links.
 */
export function findMinorCue(lines: readonly string[]): string | null {
  for (const line of lines) {
    for (const { pattern, label } of MINOR_PATTERNS) {
      if (!pattern.test(line)) continue;
      // "High school teacher", "coaching middle schoolers", "secondary
      // school reunion": an educator word marks the writer as the adult and
      // clears the line — unless the line explicitly enrolls them, in which
      // case the enrollment wins ("high school senior tutoring freshmen").
      if (!STUDENT_STRONG.test(line) && EDUCATOR_WORDS.test(line)) continue;
      return label;
    }
  }
  return null;
}

/**
 * Runs capture -> analysis -> ranking for one person.
 * Never throws: an unreadable source becomes a recorded gap, not a crash.
 */
export async function processPerson(
  runId: string,
  entry: { linkedin: string; instagram: string; name?: string },
  adapters: readonly CaptureAdapter[],
  id: string,
): Promise<PersonRecord> {
  const li = parseLinkedIn(entry.linkedin);
  const ig = parseInstagram(entry.instagram);
  if (!li.ok || !ig.ok) {
    return {
      id,
      runId,
      linkedinUrl: entry.linkedin,
      instagramUrl: entry.instagram,
      status: "failed",
      error: "The submitted links could not be parsed.",
      createdAt: Date.now(),
    };
  }

  const capture = async (kind: "linkedin" | "instagram"): Promise<SourceRecord> => {
    const input = { kind, url: kind === "linkedin" ? li.url! : ig.url!, handle: kind === "linkedin" ? li.handle! : ig.handle! };
    let last: SourceRecord | null = null;
    for (const adapter of adapters) {
      const result = await adapter.capture(input);
      if (result.status === "captured") return result;
      last = result;
    }
    return last ?? {
      kind,
      url: input.url,
      status: "pending",
      provider: "none",
    };
  };

  const [linkedin, instagram] = await Promise.all([capture("linkedin"), capture("instagram")]);

  // Age gate, enforced on content rather than claimed links. A dating product
  // must refuse school-age profiles even when the submitter attested
  // otherwise: attestations are cheap, pasted text is evidence.
  const capturedLines = [...(linkedin.lines ?? []), ...(instagram.lines ?? [])];
  const minorCue = findMinorCue(capturedLines);
  if (minorCue) {
    return {
      id,
      runId,
      displayName: entry.name || "This person",
      linkedinUrl: li.url!,
      instagramUrl: ig.url!,
      status: "failed",
      error: `This profile mentions ${minorCue}, so it was excluded: everyone in a run must be 18 or older. If that reading is wrong, remove the line and resubmit.`,
      createdAt: Date.now(),
    };
  }

  const analysis = analyse(id, { linkedin, instagram }, entry.name);
  const bothUnread = linkedin.status !== "captured" && instagram.status !== "captured";
  // A person with no readable source is NOT ready. It must be reported as a
  // failure rather than ranked and dated as if it had a profile.
  const readable = linkedin.status === "captured" || instagram.status === "captured";

  return {
    id,
    runId,
    displayName: analysis.displayName,
    linkedinUrl: li.url!,
    instagramUrl: ig.url!,
    status: readable ? "ready" : "failed",
    error: bothUnread
      ? "Neither source could be read, so no analysis was produced. Add an Apify token, or paste the visible profile text."
      : undefined,
    analysis: readable ? analysis : undefined,
    createdAt: Date.now(),
  };
}

function remapEvidence<T extends { readonly evidence: readonly Evidence[] }>(
  items: readonly T[],
  from: string,
  to: string,
): T[] {
  return items.map((item) => ({
    ...item,
    evidence: item.evidence.map((e) => (e.personId === from ? { ...e, personId: to } : e)),
  }));
}

/**
 * Gives an analysed person their final id, rewriting every identity inside
 * the analysis to match.
 *
 * The extend path captures people under placeholder ids (`tmp_1`) because
 * the real numbering is only known under the run's lock. Renaming just the
 * record left `analysis.personId` and every evidence `personId` pointing at
 * the placeholder: dates were planned for a phantom, transcripts cited
 * "this person" instead of a name, and the audit failed on unresolvable
 * quotes. Renumbering is deep or it is wrong.
 */
export function reassignPersonId(person: PersonRecord, newId: string): PersonRecord {
  const from = person.id;
  if (from === newId || !person.analysis) {
    return from === newId ? person : { ...person, id: newId };
  }
  const analysis = person.analysis;
  const remapped = {
    ...person,
    id: newId,
    analysis: {
      ...analysis,
      personId: newId,
      traits: remapEvidence(analysis.traits, from, newId),
      hobbies: remapEvidence(analysis.hobbies, from, newId),
      interests: remapEvidence(analysis.interests, from, newId),
      values: remapEvidence(analysis.values, from, newId),
      needs: remapEvidence(analysis.needs, from, newId),
      openers: remapEvidence(analysis.openers, from, newId),
    },
  };
  // Belt and braces: matches and sessions should not exist pre-merge (the
  // merge recomputes them), but if call order ever changes a stale tmp_
  // reference must not survive. Unit tests probe this shape directly.
  return {
    ...remapped,
    matches: (remapped.matches ?? []).map((m) => ({
      ...m,
      candidateId: m.candidateId === from ? newId : m.candidateId,
    })),
    sessions: (remapped.sessions ?? []).map((s) => ({
      ...s,
      personAId: s.personAId === from ? newId : s.personAId,
      personBId: s.personBId === from ? newId : s.personBId,
    })),
  };
}

/**
 * Chooses date sessions in two passes.
 *
 * Pass 1 gives every agent a date with the person THEY rank first. That is
 * the honest reading of "the agents date on their behalf": each agent's
 * opening date is its own first choice, not a pairing imposed centrally.
 * Two agents who choose each other share one session, and a popular partner
 * can pull in several otherwise-uncovered agents, so pass 1 is not simply
 * n/2 sessions.
 *
 * Pass 2 then adds the strongest remaining pairs until the run reaches
 * `target` dates. It only ever adds, never removes, because a removal could
 * leave an agent with no date at all — and coverage is the invariant that
 * matters more than hitting a round number.
 *
 * The resulting count is therefore derived rather than arbitrary: with 26
 * agents, 26 first choices might collapse into 19 distinct pairs on one data
 * set and 18 on another, and pass 2 has nothing to add once coverage already
 * exceeds the target. The demo page states the live numbers; never hardcode
 * a count here.
 */
export function planSessions(
  people: readonly { id: string; matches?: readonly { candidateId: string; overall: number }[] }[],
  target = 14,
): [string, string][] {
  const ready = people.filter((p) => (p.matches?.length ?? 0) > 0);
  if (ready.length < 2) return [];

  const sessions = new Map<string, [string, string]>();
  const covered = new Set<string>();

  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // Pass 1: each person's best available partner, so nobody is left out.
  for (const p of ready) {
    if (covered.has(p.id)) continue;
    const best = p.matches![0]!;
    if (!sessions.has(key(p.id, best.candidateId))) {
      sessions.set(key(p.id, best.candidateId), [p.id, best.candidateId]);
      covered.add(p.id);
      covered.add(best.candidateId);
    }
  }

  // Pass 2: strongest remaining pairs, for a richer demo.
  const candidates: { a: string; b: string; score: number }[] = [];
  for (const p of ready) {
    for (const m of p.matches ?? []) {
      candidates.push({ a: p.id, b: m.candidateId, score: m.overall });
    }
  }
  candidates.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a));
  for (const c of candidates) {
    if (sessions.size >= target) break;
    const k = key(c.a, c.b);
    if (!sessions.has(k)) sessions.set(k, [c.a, c.b]);
  }

  return [...sessions.values()];
}

/** Recomputes rankings and dates for a set of people, readable ones only. */
export function computeNetwork(people: PersonRecord[]): PersonRecord[] {
  const analyses = new Map<string, PersonAnalysis>();
  for (const p of people) {
    // ONLY readable people enter the pool. A person whose sources could not be
    // read used to be ranked and dated, producing transcripts about someone
    // with no data at all and an "Unknown" name in the shortlist.
    if (p.status === "ready" && p.analysis) analyses.set(p.id, p.analysis);
  }
  const list = [...analyses.values()];

  const withMatches = people.map((p) => {
    const self = analyses.get(p.id);
    if (!self) return { ...p, matches: [] };
    return { ...p, matches: rankCandidates(self, list) };
  });

  const plan = planSessions(withMatches);
  const runId = withMatches[0]?.runId ?? "run";
  const sessions: DateSession[] = [];
  for (const [aId, bId] of plan) {
    const a = analyses.get(aId);
    const b = analyses.get(bId);
    if (!a || !b) continue;
    // Use the real runId. It was previously hardcoded to "run", which made
    // DateSession.runId identical for every session in every run.
    sessions.push(runDate(runId, a, b));
  }

  // Attach each session to both participants so either profile page can show it.
  // REPLACE, do not union with p.sessions: the plan is recomputed from scratch
  // each time, so a pair chosen by an earlier plan but not the current one would
  // otherwise linger forever. That is exactly what happened when a run was
  // extended — the page then stated a date rule that the run did not follow.
  return withMatches.map((p) => ({
    ...p,
    sessions: sessions.filter((s) => s.personAId === p.id || s.personBId === p.id),
  }));
}

export function summarise(run: Run): { total: number; ready: number; failed: number; sessions: number } {
  const ready = run.people.filter((p) => p.status === "ready");
  const ids = new Set<string>();
  let sessions = 0;
  for (const p of run.people) {
    for (const s of p.sessions ?? []) {
      if (!ids.has(s.id)) {
        ids.add(s.id);
        sessions += 1;
      }
    }
  }
  return {
    total: run.people.length,
    ready: ready.length,
    failed: run.people.filter((p) => p.status === "failed").length,
    sessions,
  };
}
