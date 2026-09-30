import { getTrait } from "@/core/taxonomy";
import type {
  Evidence,
  MatchComponent,
  MatchScore,
  PersonAnalysis,
  Trait,
} from "@/core/types";

/**
 * Directed, evidence-cited match scoring.
 *
 * score(A -> B) is not score(B -> A). A is scored on how well B satisfies
 * A's NEEDS, and how much A has in common with B. B is scored independently
 * from B's own needs. Two people can therefore rank each other differently,
 * which is what makes the rankings worth reading.
 */
export function scoreMatch(
  subject: PersonAnalysis,
  candidate: PersonAnalysis,
): MatchScore {
  const components: MatchComponent[] = [];
  const evidence: Evidence[] = [];

  // --- 1. Do they share real ground? ---------------------------------------
  const candidateKeys = new Set(candidate.traits.map((t) => t.key));
  const shared: Trait[] = subject.traits.filter((t) => candidateKeys.has(t.key));
  const sharedAffinity = shared.reduce((sum, t) => {
    const def = getTrait(t.key);
    // Spending the evening doing the same specific thing beats a vague theme.
    return sum + (def?.affinity ?? 0.5);
  }, 0);
  const sharedScore = Math.min(1, sharedAffinity / 2.2);
  if (shared.length > 0) {
    components.push({
      label: "Shared ground",
      score: sharedScore,
      weight: 0.34,
      detail:
        shared.length > 0
          ? `Both profiles show ${shared.map((t) => t.label.toLowerCase()).join(", ")}.`
          : "No overlapping activities.",
      evidence: shared.flatMap((t) => t.evidence.slice(0, 1)),
    });
    evidence.push(...shared.flatMap((t) => t.evidence.slice(0, 1)));
  } else {
    components.push({
      label: "Shared ground",
      score: 0,
      weight: 0.34,
      detail: "Neither profile names an activity in common, so the first date would be pure conversation.",
      evidence: [],
    });
  }

  // --- 2. Does the candidate satisfy the subject's needs? -------------------
  const satisfied = subject.needs.filter((n) => candidateKeys.has(n.derivedFromTraitKey));
  const needScore = subject.needs.length === 0 ? 0.35 : Math.min(1, satisfied.length / subject.needs.length);
  components.push({
    label: "Meets your needs",
    score: needScore,
    weight: 0.3,
    detail:
      subject.needs.length === 0
        ? "Your sources state no clear needs, so this is scored on shared ground alone."
        : satisfied.length > 0
          ? `${satisfied.length} of ${subject.needs.length} of your stated needs appear in their profile.`
          : "None of the needs your sources imply appear in their profile.",
    evidence: satisfied.flatMap((n) => n.evidence.slice(0, 1)),
  });

  // --- 3. Value alignment ---------------------------------------------------
  const candidateValues = new Set(candidate.values.map((v) => v.key));
  const valueOverlap = subject.values.filter((v) => candidateValues.has(v.key));
  components.push({
    label: "Values",
    score: subject.values.length === 0 ? 0.4 : Math.min(1, valueOverlap.length / Math.max(1, subject.values.length)),
    weight: 0.16,
    detail:
      valueOverlap.length > 0
        ? `Aligned on ${valueOverlap.map((v) => v.label.toLowerCase()).join(", ")}.`
        : "No shared values are stated in either profile.",
    evidence: valueOverlap.flatMap((v) => v.evidence.slice(0, 1)),
  });

  // --- 4. Evidence quality --------------------------------------------------
  const subjectConf = avg(subject.traits.map((t) => t.confidence));
  const candidateConf = avg(candidate.traits.map((t) => t.confidence));
  const evidenceScore = (subjectConf + candidateConf) / 2;
  components.push({
    label: "Evidence quality",
    score: evidenceScore,
    weight: 0.2,
    detail: `Profile detail is ${evidenceScore > 0.75 ? "strong" : evidenceScore > 0.55 ? "moderate" : "thin"} on both sides.`,
    evidence: [],
  });

  const overall = components.reduce((sum, c) => sum + c.score * c.weight, 0);

  // Uncertainty is explicit so the UI can be honest about thin evidence.
  const thin = Math.min(1, (subject.gaps.length + candidate.gaps.length) / 8);
  const uncertainty = Math.min(1, thin * 0.6 + (1 - evidenceScore) * 0.4);

  return {
    personId: subject.personId,
    candidateId: candidate.personId,
    overall: round(overall),
    components,
    evidence: dedupeEvidence(evidence).slice(0, 6),
    uncertainty: round(uncertainty),
  };
}

export function rankCandidates(
  subject: PersonAnalysis,
  candidates: readonly PersonAnalysis[],
): MatchScore[] {
  return candidates
    .filter((c) => c.personId !== subject.personId)
    .map((c) => scoreMatch(subject, c))
    // Ties break on personId so the ordering is stable across runs and
    // a demo link always shows the same list.
    .sort((a, b) => b.overall - a.overall || a.candidateId.localeCompare(b.candidateId))
    .map((s, i) => ({ ...s }));
}

function avg(values: readonly number[]): number {
  if (values.length === 0) return 0.4;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dedupeEvidence(list: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of list) {
    const key = `${e.source}:${e.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
