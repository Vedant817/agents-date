import type {
  DateEvaluation,
  DateSession,
  DateTurn,
  Evidence,
  PersonAnalysis,
  Trait,
  TurnMove,
  TurnRole,
} from "@/core/types";
import { getTrait } from "@/core/taxonomy";

/**
 * Two agents date on behalf of two people.
 *
 * The conversation is assembled from what the two pairs of sources actually
 * say. Every turn carries the evidence that prompted it, so a viewer can audit
 * why an agent asked what it asked. Turns are marked with a Move so the UI can
 * show that this is a structured date, not a chat log.
 *
 * Labelling matters: these are AI simulations built from two public profiles.
 * They are not statements made by the people, and the transcript says so.
 */
export function runDate(
  runId: string,
  a: PersonAnalysis,
  b: PersonAnalysis,
): DateSession {
  const started = Date.now();

  const bKeys = new Set(b.traits.map((t) => t.key));
  const aKeys = new Set(a.traits.map((t) => t.key));
  const bByKey = new Map(b.traits.map((t) => [t.key, t]));
  const shared = a.traits.filter((t) => bKeys.has(t.key));
  const aOnly = a.traits.filter((t) => !bKeys.has(t.key));
  const bOnly = b.traits.filter((t) => !aKeys.has(t.key));

  const turns: DateTurn[] = [];
  let seq = 0;
  const add = (role: TurnRole, move: TurnMove, text: string, evidence: readonly Evidence[]) => {
    turns.push({ seq: seq++, role, move, text, evidence });
  };

  // Every turn that quotes a person must carry evidence tagged with THAT
  // person's id, so a reader can resolve the quote on the right profile page.
  const ev = (person: PersonAnalysis, ...keys: readonly (string | undefined)[]): Evidence[] => {
    const out: Evidence[] = [];
    const byKey = new Map(person.traits.map((t) => [t.key, t]));
    for (const key of keys) {
      if (!key) continue;
      const trait = byKey.get(key);
      if (!trait) continue;
      for (const e of trait.evidence) {
        if (e.personId === person.personId) out.push(e);
      }
    }
    return out;
  };

  // --- 1. Openings, each grounded in the other person's own profile ---------
  // Opener prompts are second-person ("I saw you are into X"), so the agent
  // addressing B must use B's opener material, not its own. Using your own
  // opener here made every date open by citing yourself to describe the
  // other person.
  const openA = a.openers[0];
  const openB = b.openers[0];

  add(
    "A",
    "opener",
    openB
      ? `Hi ${firstName(b)} — I am ${firstName(a)}'s agent, reading only their LinkedIn and Instagram. ${openB.prompt}`
      : `Hi ${firstName(b)} — I am ${firstName(a)}'s agent. Their two profiles are thin on detail, so I will keep this simple: what are you hoping to get out of a first date?`,
    openB?.evidence ?? [],
  );

  add(
    "B",
    "opener",
    openA
      ? `Hi ${firstName(a)} — I am ${firstName(b)}'s agent. Fair. ${openA.prompt}`
      : `Hi ${firstName(a)} — I am ${firstName(b)}'s agent. Their profiles are thin, so I am asking directly: what would make a good evening for you?`,
    openA?.evidence ?? [],
  );

  // --- 2. Shared ground, only if it is actually evidenced ------------------
  if (shared.length > 0) {
    const s = shared[0]!;
    add(
      "A",
      "shared_ground",
      `Both profiles actually show this. ${firstName(b)} lists ${s.label.toLowerCase()}, and so does ${firstName(a)} — that is the strongest thing I can verify between you.`,
      // BOTH sides cited, because the sentence claims both.
      [...ev(a, s.key), ...ev(b, s.key)],
    );

    const def = getTrait(s.key);
    add(
      "B",
      "follow_up",
      def?.category === "hobby"
        ? `Then the obvious first date is doing it, not describing it. Where does ${firstName(a)} actually do this — I can see the interest but not the place.`
        : `Then let us talk about it properly rather than small talk. What is ${firstName(a)}'s view, beyond the profile line?`,
      // The sentence asks about A's side, so it must cite A's line, not B's.
      ev(a, s.key),
    );
  } else {
    // Enumerating real traits while citing nothing makes a claim the reader
    // cannot check. Cite each side's first traits.
    add(
      "A",
      "mismatch",
      `I have to be straight with you: the two profiles share no activity at all. ${firstName(b)} shows ${sampleLabels(b.traits, 3)}, ${firstName(a)} shows ${sampleLabels(a.traits, 3)}. This date would be entirely conversational.`,
      [...ev(a, a.traits[0]?.key, a.traits[1]?.key), ...ev(b, b.traits[0]?.key, b.traits[1]?.key)].slice(0, 4),
    );
    add(
      "B",
      "curiosity",
      `Noted, and I would rather say that than pretend otherwise. ${firstName(a)} and I are going to have to find out the interesting parts in person. So: what is ${firstName(a)} like when off the clock?`,
      [],
    );
  }

  // --- 3. Curiosity about a trait only ONE side has ------------------------
  // Only a one-sided trait can honestly support "I have no evidence of it on
  // your side". Citing a shared trait here made the turn refute its own quote.
  if (aOnly.length > 0) {
    const probe = aOnly[0]!;
    const probeEvidence = ev(a, probe.key);
    add(
      "B",
      "curiosity",
      `${firstName(a)} shows ${probe.label.toLowerCase()}, and I have no evidence of it on your side. Is that something you would want to share, or something you keep off a dating profile?`,
      probeEvidence,
    );

    add(
      "A",
      "follow_up",
      `${firstName(a)}'s profile supports it, so I will answer as ${firstName(a)} would: yes, but the profile cannot tell you whether it is a social thing or a solo habit. That is the honest limit of what two links can tell me.`,
      probeEvidence,
    );
  } else if (shared.length > 0) {
    // Nothing is unique to A, so ask about the overlap instead of inventing a gap.
    const s = shared[0]!;
    add(
      "B",
      "curiosity",
      `One thing I cannot tell from either profile: ${firstName(a)} and I both show ${s.label.toLowerCase()}, but whether it is social or solitary. Which is it for you?`,
      // The sentence asserts BOTH profiles show it, so cite both sides.
      [...ev(a, s.key), ...ev(b, s.key)],
    );
    add(
      "A",
      "follow_up",
      `Also unanswerable from the profile alone. I can only tell you that both profiles show it, and I would rather ask than invent an answer for ${firstName(a)}.`,
      // Same here: "both profiles" needs a quote from each.
      [...ev(a, s.key), ...ev(b, s.key)],
    );
  } else {
    add(
      "B",
      "curiosity",
      `${firstName(a)}'s two profiles are thin, so I have nothing to go on. Tell me plainly: what is ${firstName(a)} like when off the clock?`,
      [],
    );
  }

  // --- 4. A real tension ----------------------------------------------------
  if (bOnly.length > 0) {
    const t = bOnly[0]!;
    add(
      "A",
      "mismatch",
      `One tension I should name early. ${firstName(b)} is into ${t.label.toLowerCase()}, and there is no sign of that in ${firstName(a)}'s two profiles. I cannot tell you that is a dealbreaker, but I will not pretend I saw it.`,
      ev(b, t.key),
    );
    add(
      "B",
      "follow_up",
      `Agreed, and that is the right way to say it. ${firstName(a)}'s agent is right that absence of evidence is not evidence of absence. Ask me about it properly and I will answer.`,
      [],
    );
  }

  // --- 5. Reflections from each side ---------------------------------------
  // The text claims what is verifiable on BOTH sides and what each side
  // uniquely shows, so the evidence must contain one quote from each side.
  // Truncating a self-side-only list dropped the other side in 37 of 38
  // reflections while the sentence still claimed overlap.
  const reflectionEvidence = (
    self: PersonAnalysis,
    other: PersonAnalysis,
    sharedTraits: readonly Trait[],
    selfOnlyTraits: readonly Trait[],
    otherOnlyTraits: readonly Trait[],
  ): Evidence[] => {
    const out: Evidence[] = [];
    if (sharedTraits[0]) {
      // "verifiable on both sides" needs one quote from EACH side.
      out.push(...ev(self, sharedTraits[0].key).slice(0, 1), ...ev(other, sharedTraits[0].key).slice(0, 1));
    }
    if (selfOnlyTraits[0]) out.push(...ev(self, selfOnlyTraits[0].key).slice(0, 1));
    if (otherOnlyTraits[0]) out.push(...ev(other, otherOnlyTraits[0].key).slice(0, 1));
    return out;
  };
  add("A", "reflection", reflectionFor(a, b, shared, aOnly, bOnly), reflectionEvidence(a, b, shared, aOnly, bOnly));
  add("B", "reflection", reflectionFor(b, a, shared, bOnly, aOnly), reflectionEvidence(b, a, shared, bOnly, aOnly));

  const evaluation = evaluate(turns, shared, aOnly, bOnly);

  return {
    // Deterministic and order-independent, so the same pair always yields the
    // same id regardless of which side was scheduled first.
    id: `date_${[a.personId, b.personId].sort().join("_")}`.slice(0, 120),
    runId,
    personAId: a.personId,
    personBId: b.personId,
    engine: "deterministic",
    turns,
    evaluation,
    status: "complete",
    startedAt: started,
    finishedAt: Date.now(),
  };
}

function reflectionFor(
  self: PersonAnalysis,
  other: PersonAnalysis,
  shared: readonly Trait[],
  selfOnly: readonly Trait[],
  otherOnly: readonly Trait[],
): string {
  // `let` is required by tests, but keep the fallback honest: a person whose
  // sources yielded no name must not be described with the string "Unnamed".
  const label = self.displayName.trim() && self.displayName.trim() !== "Unnamed profile"
    ? firstName(self)
    : "this person";
  const parts: string[] = [];
  if (shared.length > 0) {
    // Verb agreement: "wine is verifiable" reads correctly, "wine are" does
    // not. With two items the plural is right.
    const named = shared.slice(0, 2).map((t) => t.label.toLowerCase());
    parts.push(
      `For ${label} I would call this promising: ${named.join(" and ")} ${named.length > 1 ? "are" : "is"} verifiable on both sides.`,
    );
  } else {
    parts.push(`For ${label} I would call this uncertain: nothing in the two profiles overlaps.`);
  }
  if (selfOnly.length > 0) {
    parts.push(`What only ${label} shows is ${selfOnly.slice(0, 2).map((t) => t.label.toLowerCase()).join(", ")}.`);
  }
  if (otherOnly.length > 0) {
    parts.push(`What ${firstName(other)} has that ${label} does not is ${otherOnly.slice(0, 2).map((t) => t.label.toLowerCase()).join(", ")}, which is worth a real question rather than a guess.`);
  }
  // The closer varies with the outcome instead of repeating one boilerplate
  // sentence on every date. All three are suggestions, never assertions, so
  // no closer can state anything the evidence does not support.
  const mismatch = selfOnly.length + otherOnly.length;
  if (shared.length === 0) {
    parts.push("With no overlap on paper, the honest next step is one low-stakes meeting, not more analysis.");
  } else if (mismatch >= 6) {
    parts.push("The differences are the interesting part here: go find out which ones matter in person.");
  } else {
    parts.push("I would suggest a short, active first date and see whether the conversation survives contact.");
  }
  return parts.join(" ");
}

function evaluate(
  turns: readonly DateTurn[],
  shared: readonly Trait[],
  aOnly: readonly Trait[],
  bOnly: readonly Trait[],
): DateEvaluation {
  const notes: string[] = [];
  const sharedGround = Math.min(1, shared.length / 3);
  const reciprocity = turns.filter((t) => t.role === "B").length / Math.max(1, turns.filter((t) => t.role === "A").length);
  const evidential = turns.filter((t) => t.evidence.length > 0).length / Math.max(1, turns.length);
  const depth = Math.min(1, turns.length / 8);
  const mismatchRisk = Math.min(1, (aOnly.length + bOnly.length) / 8);

  if (shared.length === 0) {
    notes.push("No evidenced overlap between the two profiles.");
  } else {
    notes.push(`Overlap evidenced on: ${shared.map((t) => t.label).join(", ")}.`);
  }
  notes.push(`${Math.round(evidential * 100)}% of turns cite a source line.`);
  if (mismatchRisk > 0.5) {
    notes.push("Each side shows traits the other does not; expect the first date to be exploratory.");
  }

  const overall =
    sharedGround * 0.38 +
    Math.min(1, reciprocity) * 0.18 +
    depth * 0.18 +
    evidential * 0.26 -
    mismatchRisk * 0.1;

  return {
    reciprocity: round(Math.min(1, reciprocity)),
    sharedGround: round(sharedGround),
    depth: round(depth),
    mismatchRisk: round(mismatchRisk),
    overall: round(Math.max(0, Math.min(1, overall))),
    notes,
  };
}

export type DateVerdict = "Second date" | "Maybe" | "Skip";

/**
 * The trailer verdict: a calibrated reading of the score, not the score
 * itself. "0.72 vs 0.68" means nothing to a visitor; the verdict plus the
 * best line and the tension is what makes a date skimmable — reading the
 * full transcript becomes optional instead of mandatory.
 */
export function dateVerdict(overall: number): DateVerdict {
  if (overall >= 0.7) return "Second date";
  if (overall >= 0.5) return "Maybe";
  return "Skip";
}

export interface DateTrailer {
  readonly verdict: DateVerdict;
  readonly overall: number;
  /** First shared-ground turn, if the date found any. */
  readonly bestLine: string | null;
  /** First mismatch turn, if anything grated. */
  readonly tension: string | null;
}

/** Picks the two skimmable moments out of a finished date. Pure readout. */
export function trailerFor(session: DateSession): DateTrailer | null {
  if (!session.evaluation) return null;
  const best = session.turns.find((t) => t.move === "shared_ground") ?? null;
  const tension = session.turns.find((t) => t.move === "mismatch") ?? null;
  return {
    verdict: dateVerdict(session.evaluation.overall),
    overall: session.evaluation.overall,
    bestLine: best ? best.text : null,
    tension: tension ? tension.text : null,
  };
}

/**
 * A person's short, safe label for use inside a sentence.
 *
 * Falls back to "this person" rather than "Unnamed profile", which would read
 * as a claim that someone's name is literally "Unnamed".
 */
function firstName(a: PersonAnalysis): string {
  const n = a.displayName.trim();
  if (!n || n === "Unnamed profile") return "this person";
  const first = n.split(/\s+/)[0] ?? n;
  // Truncate by code point so an emoji name is not cut into a replacement char.
  const chars = [...first];
  return chars.length > 18 ? `${chars.slice(0, 17).join("")}…` : first;
}

function sampleLabels(traits: readonly Trait[], n: number): string {
  if (traits.length === 0) return "nothing specific";
  return traits.slice(0, n).map((t) => t.label.toLowerCase()).join(", ");
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
