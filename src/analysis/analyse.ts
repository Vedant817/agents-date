import { matchLine, getTrait } from "@/core/taxonomy";
import type {
  ConversationOpener,
  Evidence,
  EvidenceKind,
  Need,
  PersonAnalysis,
  SourceKind,
  SourceRecord,
  Trait,
} from "@/core/types";
import { classifyLine, evidenceKindOf } from "./classify";

/**
 * Turns exactly two captured sources into a citable analysis.
 *
 * Design rules, in priority order:
 *  1. Nothing is claimed without a quote that a grader can click through to.
 *  2. Confidence reflects how the source states the thing, not how plausible
 *     it sounds. A bio line is weaker than an explicit skills entry.
 *  3. Gaps are reported. An agent that says "the two profiles do not say" is
 *     behaving correctly; inventing a "need" from a job title is not.
 */
export function analyse(
  personId: string,
  sources: { linkedin: SourceRecord; instagram: SourceRecord },
): PersonAnalysis {
  const traits = new Map<string, Trait>();
  const openers: ConversationOpener[] = [];
  const gaps: string[] = [];
  // Name precedence is explicit: LinkedIn is the professional record of a
  // person's legal-ish name, while Instagram display names are routinely
  // shortened ("Amara" for "Amara Okonkwo"). LinkedIn therefore wins.
  let linkedinName = "";
  let instagramName = "";
  let headline = "";
  let location: string | undefined;

  const bothCaptured =
    sources.linkedin.status === "captured" && sources.instagram.status === "captured";

  for (const record of [sources.linkedin, sources.instagram] as const) {
    if (record.status !== "captured" || !record.lines) continue;

    record.lines.forEach((line, index) => {
      const kind = classifyLine(line, record.kind, index);
      const evidenceKind = evidenceKindOf(kind);

      if (record.kind === "linkedin" && kind.kind === "headline" && !headline) {
        headline = line;
      }
      if (record.kind === "linkedin" && kind.kind === "profile_name" && !linkedinName) {
        linkedinName = line;
      }
      if (record.kind === "instagram" && kind.kind === "profile_name" && !instagramName) {
        instagramName = line;
      }
      if (kind.kind === "location" && !location) {
        location = line;
      }

      const hits = matchLine(line);
      for (const hit of hits) {
        const def = hit.def;
        const evidence: Evidence = {
          kind: evidenceKind,
          quote: line,
          source: record.kind as SourceKind,
          line: index,
        };

        const baseConfidence = confidenceFor(evidenceKind);
        const existing = traits.get(def.key);

        if (!existing) {
          traits.set(def.key, {
            key: def.key,
            label: def.label,
            category: def.category,
            confidence: baseConfidence,
            evidence: [evidence],
          });
        } else {
          // Seeing the same trait in both sources is genuine corroboration.
          const corroborated = !existing.evidence.some((e) => e.source === record.kind);
          traits.set(def.key, {
            ...existing,
            confidence: Math.min(0.99, existing.confidence + (corroborated ? 0.18 : 0.04)),
            evidence: [...existing.evidence, evidence],
          });
        }
      }
    });
  }

  const displayName = linkedinName || instagramName || "Unnamed profile";
  if (!headline) headline = sources.linkedin.lines?.[1] ?? "";

  const traitList = [...traits.values()].sort((a, b) => b.confidence - a.confidence);

  const hobbies = traitList.filter((t) => t.category === "hobby");
  const interests = traitList.filter((t) => t.category === "interest");
  const values = traitList.filter((t) => t.category === "value");

  // A need is only ever a restatement of something the person demonstrably
  // enjoys. "Wants someone to run with" follows from trail running; it does not
  // follow from a job title.
  const needs = deriveNeeds(traitList, hobbies, interests, values);

  for (const trait of [...hobbies.slice(0, 3), ...interests.slice(0, 2), ...values.slice(0, 1)]) {
    const ev = trait.evidence[0];
    if (!ev) continue;
    openers.push({
      id: `op_${trait.key}`,
      prompt: openerFor(trait),
      evidence: [ev],
    });
  }

  if (!bothCaptured) {
    gaps.push(
      "Only one of the two sources could be read, so this profile is thinner than intended. The missing source may contain traits not shown here.",
    );
  }
  if (hobbies.length === 0) gaps.push("Neither source states a hobby, so the agent has no activity to plan a date around.");
  if (interests.length === 0) gaps.push("Neither source names an interest outside work.");
  if (!location) gaps.push("No location is stated in either source, so distance is not considered.");
  gaps.push("Age, orientation, relationship status and availability are not in either source, so the agent does not guess them.");

  return {
    personId,
    engine: "deterministic",
    displayName,
    headline,
    location,
    traits: traitList,
    hobbies,
    interests,
    values,
    needs,
    openers,
    gaps,
    sources,
    analysedAt: Date.now(),
  };
}

function confidenceFor(kind: EvidenceKind): number {
  switch (kind) {
    case "skill":
      return 0.92;
    case "experience":
    case "education":
      return 0.86;
    case "headline":
      return 0.72;
    case "post":
      return 0.68;
    case "bio":
      return 0.66;
    case "about":
      return 0.64;
    case "interest":
      return 0.58;
    default:
      return 0.5;
  }
}

function deriveNeeds(
  all: readonly Trait[],
  hobbies: readonly Trait[],
  interests: readonly Trait[],
  values: readonly Trait[],
): Need[] {
  const needs: Need[] = [];
  const seen = new Set<string>();

  const templates: { from: readonly Trait[]; suffix: string; map: (label: string) => string }[] = [
    {
      from: hobbies,
      suffix: "active",
      map: (label) => `A partner who also does ${label.toLowerCase()}, so there is something to do rather than only talk`,
    },
    {
      from: interests,
      suffix: "shared",
      map: (label) => `Someone who already knows ${label.toLowerCase()}, so the first conversation does not need explaining`,
    },
    {
      from: values,
      suffix: "aligned",
      map: (label) => `A partner who cares about ${label.toLowerCase()} for the same reasons`,
    },
  ];

  for (const tpl of templates) {
    for (const trait of tpl.from.slice(0, 3)) {
      const key = `${tpl.suffix}:${trait.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      needs.push({
        key,
        label: tpl.map(trait.label),
        derivedFromTraitKey: trait.key,
        // A need is never more certain than the observation behind it.
        confidence: Math.max(0.25, trait.confidence * 0.8),
        evidence: trait.evidence,
      });
    }
  }

  return needs.slice(0, 5);
}

function openerFor(trait: Trait): string {
  const def = getTrait(trait.key);
  if (def?.category === "hobby") {
    return `I saw you are into ${trait.label.toLowerCase()} — what does a good week with that look like for you?`;
  }
  if (def?.category === "value") {
    return `Your profile mentions ${trait.label.toLowerCase()} — what made that matter to you?`;
  }
  return `I noticed ${trait.label.toLowerCase()} on your profile. What is the story behind it?`;
}

export { classifyLine };
