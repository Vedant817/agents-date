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
    if (index === 0 && line.length <= 60 && !/ at |@|\d{4}/i.test(line)) {
      return { kind: "profile_name" };
    }
    if (/^(skills?|expertise|tools)\b|^(react|python|node|sql|aws|figma|design|leadership|strategy|management)\b/.test(l)) {
      return { kind: "skill" };
    }
    if (/\b(university|college|school|bachelor|master|phd|degree|graduat)/.test(l)) {
      return { kind: "education" };
    }
    if (/\b(manager|engineer|designer|director|developer|analyst|consultant|founder|scientist|researcher|architect)\b/.test(l)) {
      return { kind: "experience" };
    }
    if (index <= 2) return { kind: "headline" };
    if (l.length > 120) return { kind: "about" };
    return { kind: "skill" };
  }

  // Instagram: first non-empty line is the display name, longer lines read as
  // post captions.
  if (index === 0 && line.length <= 50) return { kind: "profile_name" };
  if (index === 1) return { kind: "bio" };
  if (/^based in|^located in|^[\w\s]+,\s*[a-z]{2}$/i.test(line) && line.length < 40) {
    return { kind: "location" };
  }
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
