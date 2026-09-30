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
  // Weights sum to 1.0. "Shared ground" and "Adds something new" are the two
  // largest, because the product is about finding someone to do things with.
  const W = {
    shared: 0.3,
    needs: 0.26,
    additive: 0.18,
    evidence: 0.16,
    values: 0.1,
  } as const;

  // --- 1. Do they share real ground? ---------------------------------------
  const candidateByKey = new Map(candidate.traits.map((t) => [t.key, t]));
  const candidateKeys = new Set(candidateByKey.keys());
  const shared: Trait[] = subject.traits.filter((t) => candidateKeys.has(t.key));
  const sharedAffinity = shared.reduce((sum, t) => {
    const def = getTrait(t.key);
    // Spending the evening doing the same specific thing beats a vague theme.
    return sum + (def?.affinity ?? 0.5);
  }, 0);
  const sharedScore = Math.min(1, sharedAffinity / 2.2);
  if (shared.length > 0) {
    // The detail says "both profiles show X", so the evidence must include a
    // quote from each side. Citing only the subject left the claim unproven.
    const sharedEvidence = shared.flatMap((t) => {
      const mine = t.evidence.filter((e) => e.personId === subject.personId).slice(0, 1);
      const theirs = candidateByKey.get(t.key)?.evidence.filter((e) => e.personId === candidate.personId).slice(0, 1) ?? [];
      return [...mine, ...theirs];
    });
    components.push({
      label: "Shared ground",
      score: sharedScore,
      weight: W.shared,
      detail: `Both profiles show ${shared.map((t) => t.label.toLowerCase()).join(", ")}.`,
      evidence: sharedEvidence.slice(0, 4),
    });
    evidence.push(...sharedEvidence);
  } else {
    components.push({
      label: "Shared ground",
      score: 0,
      weight: W.shared,
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
    weight: W.needs,
    detail:
      subject.needs.length === 0
        ? "Your sources state no clear needs, so this is scored on shared ground alone."
        : satisfied.length > 0
          ? `${satisfied.length} of ${subject.needs.length} of your stated needs appear in their profile.`
          : "None of the needs your sources imply appear in their profile.",
    // The claim is about the CANDIDATE, so cite the candidate's own line.
    evidence: satisfied
      .flatMap((n) => candidateByKey.get(n.derivedFromTraitKey)?.evidence.filter((e) => e.personId === candidate.personId).slice(0, 1) ?? [])
      .slice(0, 3),
  });

  // --- 3. Value alignment ---------------------------------------------------
  const candidateValueKeys = new Set(candidate.values.map((v) => v.key));
  const valueOverlap = subject.values.filter((v) => candidateValueKeys.has(v.key));
  components.push({
    label: "Values",
    score: subject.values.length === 0 ? 0.4 : Math.min(1, valueOverlap.length / Math.max(1, subject.values.length)),
    weight: W.values,
    detail:
      valueOverlap.length > 0
        ? `Aligned on ${valueOverlap.map((v) => v.label.toLowerCase()).join(", ")}.`
        : "No shared values are stated in either profile.",
    evidence: valueOverlap
      .flatMap((v) => candidate.traits.find((t) => t.key === v.key)?.evidence.filter((e) => e.personId === candidate.personId).slice(0, 1) ?? [])
      .slice(0, 2),
  });

  // --- 4. Additive vs redundant ---------------------------------------------
  // Genuinely directional, and the component that removes false ties.
  // Shared ground is symmetric by definition, so two people who overlap
  // equally scored identically regardless of who they were. This asks whether
  // the candidate BRINGS something the subject lacks, weighed against how much
  // of that they already have. Being the 4th running-adjacent hobby is
  // redundant; being someone's only music interest is additive.
  const subjectHobbyCategories = new Set(
    subject.hobbies.map((h) => (getTrait(h.key)?.category ?? "hobby") + ":" + h.key.split(":")[0]),
  );
  const additive = candidate.traits.filter((t) => {
    const bucket = `${t.category}:${t.key.split(":")[0]}`;
    return !subject.traits.some((s) => `${s.category}:${s.key.split(":")[0]}` === bucket);
  });
  const redundancy = candidate.traits.filter((t) =>
    subjectHobbyCategories.has(`${t.category}:${t.key.split(":")[0]}`),
  );
  const addScore = candidate.traits.length === 0 ? 0.3 : Math.min(1, additive.length / Math.max(2, candidate.traits.length * 0.6));
  const redundancyPenalty = subject.traits.length === 0 ? 0 : Math.min(0.5, redundancy.length / subject.traits.length);
  components.push({
    label: "Adds something new",
    score: Math.max(0, addScore - redundancyPenalty),
    weight: W.additive,
    detail:
      candidate.traits.length === 0
        ? "Their profiles name nothing to bring to a date."
        : additive.length > 0
          ? `They show ${additive.slice(0, 2).map((t) => t.label.toLowerCase()).join(" and ")}, which you do not already have.`
          : "Everything they show is something you already have too, so there is less to discover.",
    evidence: additive
      .flatMap((t) => t.evidence.filter((e) => e.personId === candidate.personId).slice(0, 1))
      .slice(0, 2),
  });

  // --- 5. Evidence quality --------------------------------------------------
  const subjectConf = avg(subject.traits.map((t) => t.confidence));
  const candidateConf = avg(candidate.traits.map((t) => t.confidence));
  // Weighted 2:1 toward the candidate, because a match is only as trustworthy
  // as the thinner of the two profiles. A plain average was provably symmetric.
  const evidenceScore = (subjectConf + candidateConf * 2) / 3;
  components.push({
    label: "Evidence quality",
    score: evidenceScore,
    weight: W.evidence,
    detail: `Profile detail is ${evidenceScore > 0.75 ? "strong" : evidenceScore > 0.55 ? "moderate" : "thin"} on both sides, and their side weighs most.`,
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
    // Include personId: the same quote from two people is two distinct facts.
    const key = `${e.personId}:${e.source}:${e.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
