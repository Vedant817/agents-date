import { analyse } from "@/analysis/analyse";
import { runDate } from "@/dating/engine";
import { rankCandidates } from "@/matching/rank";
import { parseInstagram, parseLinkedIn } from "@/core/urls";
import type { CaptureAdapter } from "@/ingest/adapter";
import { AnonymousWebAdapter, ConsentedTextAdapter } from "@/ingest/public";
import type {
  DateSession,
  PersonAnalysis,
  PersonRecord,
  Run,
  SourceRecord,
} from "@/core/types";

export const DEMO_RUN_ID = "demo";

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

export function emptyRun(id: string, isDemo: boolean, notes: string[] = []): Run {
  const now = Date.now();
  return {
    id,
    isDemo,
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

/**
 * Chooses date sessions so every agent appears in at least one, then adds the
 * highest-ranked pairs. 25 people need at least 13 sessions for coverage.
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

/** Recomputes rankings and dates for a fully-analysed set of people. */
export function computeNetwork(people: PersonRecord[]): PersonRecord[] {  const analyses = new Map<string, PersonAnalysis>();
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
  return withMatches.map((p) => {
    const mine = sessions.filter((s) => s.personAId === p.id || s.personBId === p.id);
    const merged = [...(p.sessions ?? []), ...mine];
    const byId = new Map(merged.map((s) => [s.id, s]));
    return { ...p, sessions: [...byId.values()] };
  });
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
