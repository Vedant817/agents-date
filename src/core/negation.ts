/**
 * Shared negation logic for trait matching AND the integrity audit.
 *
 * These two MUST agree: the matcher decides a mention means the opposite and
 * drops the trait; the audit flags a stored trait whose own quote refutes it.
 * When each had its own cue list, multi-word cues ("gave up", "nothing to do
 * with") were dead code in the matcher — `includes()` over single tokens can
 * never match a phrase — while the audit reimplemented the same single-token
 * bug, so "I gave up running" shipped as a confident Running trait AND the
 * audit certified it. One module, one predicate, both callers.
 */

/** Single-word cues, matched against tokenised clause words. */
export const NEGATION_SINGLE_CUES = [
  "hate", "hates", "hated", "dislike", "dislikes", "never", "no", "not", "isnt",
  "cant", "cannot", "wont", "avoid", "avoids", "against", "quit", "stopped",
  "former", "anti", "uninterested", "allergic", "allergies", "intolerant",
  "zero", "none", "without", "except", "scraped", "deleted", "bad",
];

/**
 * Multi-word cues, searched as phrases in the clause string. These were
 * listed for years but could never fire while the check was token-based.
 * Abandonment ("used to", "gave up", "quit") suppresses the same way: past
 * enthusiasm stated as over is not a current trait.
 */
export const NEGATION_PHRASE_CUES = [
  "used to",
  "gave up",
  "nothing to do with",
  "not into",
  "not a fan",
  "rather not",
];

/**
 * "Without X I cannot function" is dependence, i.e. enthusiasm, not dislike.
 * Without this exception the over-broad "without"+"cannot" cues turned a
 * coffee lover trait-less. Same for litotes — "not unhappy", "don't
 * dislike", "never not" all affirm by negating a negative. Rare in bios,
 * always a false negative when hit.
 */
const WITHOUT_NEED = /\bwithout\b[\s\S]*\b(can ?not|cannot|can't|unable)\b[\s\S]*\b(function|live|survive|sleep|start|get going)\b/;
const LITOTES = /\b(not unhappy|don't dislike|doesn't dislike|never not|not uninteresting)\b/;

/** First word of a matched form, never treated as its own negation cue. */
export function traitWordOf(form: string): string {
  return form.toLowerCase().split(/\s+/)[0] ?? form;
}

/**
 * The clause containing a match at idx: from the previous boundary to the
 * next one. Both directions matter. Backward-only scoping missed
 * forward-context disambiguation ("Without coffee I cannot function" — the
 * "cannot function" that rescues coffee comes AFTER the trait word), and
 * missed postposed negation ("running is not for me").
 */
export function extractClause(line: string, idx: number): string {
  const lower = line.toLowerCase();
  const before = lower.slice(0, idx);
  const lastBreak = Math.max(
    before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("."),
    before.lastIndexOf("!"), before.lastIndexOf("?"),
    before.lastIndexOf(" but "), before.lastIndexOf(" though "), before.lastIndexOf(" although "),
  );
  const clauseStart = lastBreak >= 0 ? lastBreak + 1 : 0;
  const after = lower.slice(idx);
  const nextBreak = (() => {
    const candidates = [
      after.indexOf(","), after.indexOf(";"), after.indexOf("."), after.indexOf("!"), after.indexOf("?"),
      after.indexOf(" but "), after.indexOf(" though "), after.indexOf(" although "),
    ].filter((n) => n >= 0);
    return candidates.length > 0 ? Math.min(...candidates) : -1;
  })();
  const clauseEnd = nextBreak >= 0 ? idx + nextBreak : lower.length;
  return lower.slice(clauseStart, clauseEnd);
}

/**
 * True when the trait word is negated (or abandoned) in its own clause.
 * `form` is the matched surface form; matching is case-insensitive.
 */
export function isTraitNegated(line: string, form: string): boolean {
  const lower = line.toLowerCase();
  const idx = lower.indexOf(form.toLowerCase());
  if (idx === -1) return false;
  const clause = extractClause(line, idx);

  if (WITHOUT_NEED.test(clause)) return false;
  if (LITOTES.test(clause)) return false;

  for (const phrase of NEGATION_PHRASE_CUES) {
    if (clause.includes(phrase)) return true;
  }

  const words = clause.split(/[^a-z]+/).filter(Boolean);
  const traitWord = traitWordOf(form);
  for (const w of words) {
    if (w === traitWord) continue;
    if (NEGATION_SINGLE_CUES.includes(w)) return true;
  }
  return false;
}
