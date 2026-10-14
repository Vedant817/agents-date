import type { DateSession, DateTurn, Evidence } from "@/core/types";

/**
 * Paraphrasing is the ONLY place a language model may touch a date, and it
 * may touch only the surface: move, role, speaker ids and the evidence array
 * must come back byte-identical. Anything else is a fabrication risk, so any
 * deviation falls back to the original text turn by turn.
 *
 * Production uses IdentityParaphraser (no model configured). HttpParaphraser
 * calls a caller-provided endpoint when PARAPHRASE_URL/PARAPHRASE_KEY are set;
 * no provider SDK is installed until that decision is made. verifyParaphrase
 * is the gate: the audit re-runs on paraphrased output before it can ship.
 */

export interface TurnParaphraser {
  readonly name: string;
  paraphrase(session: DateSession): Promise<DateSession>;
}

/** Today's production behavior: the deterministic text ships untouched. */
export class IdentityParaphraser implements TurnParaphraser {
  readonly name = "identity";
  async paraphrase(session: DateSession): Promise<DateSession> {
    return session;
  }
}

export interface ParaphraseRequestTurn {
  readonly seq: number;
  readonly move: string;
  readonly role: string;
  readonly text: string;
}

export interface ParaphraseEndpoint {
  paraphraseTurns(turns: ParaphraseRequestTurn[]): Promise<{ seq: number; text: string }[]>;
}

/**
 * Model-backed paraphrasing with a deterministic leash. Each returned text
 * replaces only that turn's prose; moves, roles, speakers and evidence are
 * never taken from the model. A turn whose replacement is missing, empty, or
 * duplicated keeps its original text instead of failing the date.
 */
export class EndpointParaphraser implements TurnParaphraser {
  readonly name = "endpoint";
  constructor(private readonly endpoint: ParaphraseEndpoint) {}

  async paraphrase(session: DateSession): Promise<DateSession> {
    let replacements: { seq: number; text: string }[];
    try {
      replacements = await this.endpoint.paraphraseTurns(
        session.turns.map((t) => ({ seq: t.seq, move: t.move, role: t.role, text: t.text })),
      );
    } catch {
      return session;
    }
    const bySeq = new Map<number, string>();
    for (const r of replacements ?? []) {
      // First valid replacement wins: a duplicated seq must not let a later
      // entry clobber the earlier one.
      if (typeof r?.seq === "number" && typeof r?.text === "string" && r.text.trim().length > 0) {
        if (!bySeq.has(r.seq)) bySeq.set(r.seq, r.text);
      }
    }
    return {
      ...session,
      turns: session.turns.map((t) => {
        const text = bySeq.get(t.seq);
        return text === undefined ? t : { ...t, text };
      }),
    };
  }
}

/**
 * The shipping gate: returns every way a paraphrased session differs from
 * its original outside the turn prose. Empty means shippable — the audit
 * suite re-runs on the paraphrased session before it can replace anything.
 */
export function verifyParaphrase(original: DateSession, paraphrased: DateSession): string[] {
  const problems: string[] = [];
  if (original.id !== paraphrased.id) problems.push("session id changed");
  if (original.personAId !== paraphrased.personAId || original.personBId !== paraphrased.personBId) {
    problems.push("participants changed");
  }
  if (original.turns.length !== paraphrased.turns.length) {
    problems.push(`turn count changed: ${original.turns.length} to ${paraphrased.turns.length}`);
    return problems;
  }
  const sameEvidence = (a: readonly Evidence[], b: readonly Evidence[]): boolean => {
    if (a.length !== b.length) return false;
    return a.every(
      (e, i) =>
        e.quote === b[i]!.quote &&
        e.personId === b[i]!.personId &&
        e.source === b[i]!.source &&
        e.line === b[i]!.line &&
        e.kind === b[i]!.kind,
    );
  };
  original.turns.forEach((t: DateTurn, i: number) => {
    const p = paraphrased.turns[i]!;
    if (t.seq !== p.seq) problems.push(`turn ${i} re-sequenced`);
    if (t.role !== p.role) problems.push(`turn ${t.seq} role changed`);
    if (t.move !== p.move) problems.push(`turn ${t.seq} move changed`);
    if (!sameEvidence(t.evidence, p.evidence)) problems.push(`turn ${t.seq} evidence altered`);
    if (p.text.trim().length === 0) problems.push(`turn ${t.seq} emptied`);
  });
  return problems;
}
