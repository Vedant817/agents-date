import type { EvidenceKind, SourceKind } from "@/core/types";

export type Classified =
  | { kind: "profile_name" }
  | { kind: "headline" }
  | { kind: "about" }
  | { kind: "experience" }
  | { kind: "education" }
  | { kind: "skill" }
  | { kind: "post" }
  | { kind: "bio" }
  | { kind: "location" }
  | { kind: "interest" }
  | { kind: "other" };

/**
 * Decide what a captured line actually IS, so confidence can reflect how
 * directly the source states the trait.
 *
 * Ordering matters: the more specific patterns are tested first, otherwise a
 * skills line could be swallowed by the generic "about" branch.
 */
export function classifyLine(
  line: string,
  source: SourceKind,
  index: number,
): Classified {
  const l = line.toLowerCase();

  if (source === "linkedin") {
    if (index === 0 && line.length <= 60 && !/\s+at\s+|@|\d{4}/i.test(line)) {
      return { kind: "profile_name" };
    }
    if (/^(skills?|expertise|tools)\b/.test(l)) {
      return { kind: "skill" };
    }
    if (/\b(university|college|school|bachelor|master|phd|degree|graduat)\b/.test(l)) {
      return { kind: "education" };
    }
    if (/\b(manager|engineer|designer|director|developer|analyst|consultant|founder|scientist|researcher|architect)\b/.test(l)) {
      return { kind: "experience" };
    }
    if (index <= 2) return { kind: "headline" };
    if (l.length > 120) return { kind: "about" };
    // The fallthrough must NOT be "skill". Skill is the highest-confidence
    // kind, so defaulting to it gave arbitrary prose a 0.92 score and let a
    // keyword-stuffed bio outrank a substantive one.
    if (l.length > 40) return { kind: "about" };
    return { kind: "interest" };
  }

  // Instagram: first non-empty line is the display name, longer lines read as
  // post captions.
  if (index === 0 && line.length <= 50) return { kind: "profile_name" };
  // Location must be an explicit statement. A bare "Pasta, it" caption used to
  // match the old /word, XX$/ pattern and became a person's location.
  if (/^(based in|located in|living in|from)\s+/i.test(line) && line.length < 60) {
    return { kind: "location" };
  }
  if (index === 1) return { kind: "bio" };
  if (l.length > 80) return { kind: "post" };
  return { kind: "interest" };
}

export function evidenceKindOf(c: Classified): EvidenceKind {
  switch (c.kind) {
    case "profile_name":
      return "headline";
    case "other":
      return "interest";
    default:
      return c.kind;
  }
}
