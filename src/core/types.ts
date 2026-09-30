/**
 * Core domain model.
 *
 * One hard rule shapes this file: a person is described by EXACTLY TWO sources,
 * a LinkedIn profile and a public Instagram profile. Every trait an agent
 * infers must trace back to evidence captured from one of those two sources.
 * If we cannot cite it, we do not claim it.
 */

export type SourceKind = "linkedin" | "instagram";

/** The two sources for a person are both required and both fixed in shape. */
export interface SourcePair {
  readonly linkedin: SourceRecord;
  readonly instagram: SourceRecord;
}

export type SourceStatus =
  /** Captured successfully; evidence may be used. */
  | "captured"
  /** Attempted but the public profile could not be read. */
  | "unavailable"
  /** Not yet attempted. */
  | "pending";

export interface SourceRecord {
  readonly kind: SourceKind;
  /** Normalized canonical URL that was submitted. */
  readonly url: string;
  readonly status: SourceStatus;
  /** Unix ms when the capture attempt happened. */
  readonly capturedAt?: number;
  /**
   * Raw text lines pulled from the public profile, used as the only
   * material the analyser is allowed to read.
   */
  readonly lines?: readonly string[];
  /** Present only when status is "unavailable". */
  readonly reason?: string;
  /**
   * Which adapter produced this record. Lets the UI be honest about whether a
   * profile came from a live provider or the offline snapshot path.
   */
  readonly provider?: string;
}

export type EvidenceKind = "headline" | "about" | "experience" | "education" | "skill" | "post" | "bio" | "interest" | "location";

/**
 * A single citable observation. `quote` is verbatim text from the source and
 * `line` is the index into SourceRecord.lines, so the UI can show the exact
 * line that justified a claim.
 */
export interface Evidence {
  readonly kind: EvidenceKind;
  readonly quote: string;
  readonly source: SourceKind;
  readonly line?: number;
}

export type TraitCategory =
  | "interest"
  | "hobby"
  | "value"
  | "need"
  | "skill"
  | "context";

/**
 * A single normalized quality about a person, e.g. hobby:"trail running".
 * Deliberately canonical (lowercase, pipe-separated) so that two profiles can
 * be compared with a plain key match instead of fuzzy string guessing.
 */
export interface Trait {
  readonly key: string;
  readonly label: string;
  readonly category: TraitCategory;
  /** 0..1, derived from how directly the source states it. */
  readonly confidence: number;
  readonly evidence: readonly Evidence[];
}

/**
 * What the agent is looking for in a partner. Derived only from stated
 * interests/hobbies in the two sources -- never invented romance signals.
 */
export interface Need {
  readonly key: string;
  readonly label: string;
  /** The trait on this person that motivates the need. */
  readonly derivedFromTraitKey: string;
  readonly confidence: number;
  readonly evidence: readonly Evidence[];
}

/**
 * Questions the agent wants to ask, each anchored to a source line. Used to
 * open a date conversation without inventing personal history.
 */
export interface ConversationOpener {
  readonly id: string;
  readonly prompt: string;
  readonly evidence: readonly Evidence[];
}

export type AnalysisEngine = "deterministic" | "llm";

export interface PersonAnalysis {
  readonly personId: string;
  readonly engine: AnalysisEngine;
  readonly displayName: string;
  readonly headline: string;
  readonly location?: string;
  readonly traits: readonly Trait[];
  readonly hobbies: readonly Trait[];
  readonly interests: readonly Trait[];
  readonly values: readonly Trait[];
  readonly needs: readonly Need[];
  readonly openers: readonly ConversationOpener[];
  /**
   * Attributes the two sources did not support. Surfacing these honestly is
   * part of the product: an agent that admits a gap is more useful than one
   * that guesses.
   */
  readonly gaps: readonly string[];
  readonly sources: SourcePair;
  readonly analysedAt: number;
}

// --- Dating -----------------------------------------------------------------

export type TurnRole = "A" | "B";

export type TurnMove =
  | "opener"
  | "follow_up"
  | "shared_ground"
  | "curiosity"
  | "reflection"
  | "mismatch";

export interface DateTurn {
  readonly seq: number;
  readonly role: TurnRole;
  readonly move: TurnMove;
  readonly text: string;
  readonly evidence: readonly Evidence[];
}

export interface DateEvaluation {
  readonly reciprocity: number;
  readonly sharedGround: number;
  readonly depth: number;
  readonly mismatchRisk: number;
  readonly overall: number;
  readonly notes: readonly string[];
}

export interface DateSession {
  readonly id: string;
  readonly runId: string;
  readonly personAId: string;
  readonly personBId: string;
  readonly engine: AnalysisEngine;
  readonly turns: readonly DateTurn[];
  readonly evaluation?: DateEvaluation;
  readonly status: "planned" | "complete" | "failed";
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
}

// --- Ranking ----------------------------------------------------------------

export interface MatchComponent {
  readonly label: string;
  /** 0..1 contribution. */
  readonly score: number;
  readonly weight: number;
  readonly detail: string;
  readonly evidence: readonly Evidence[];
}

/**
 * Ranking is DIRECTED: A's score for B may differ from B's score for A,
 * because A's needs and what A can offer are not B's.
 */
export interface MatchScore {
  readonly personId: string;
  readonly candidateId: string;
  readonly overall: number;
  readonly components: readonly MatchComponent[];
  readonly evidence: readonly Evidence[];
  /** 0..1, how much we are inferring. High uncertainty lowers confidence. */
  readonly uncertainty: number;
  readonly sessionId?: string;
}

// --- Run orchestration ------------------------------------------------------

export type PersonStatus = "pending" | "capturing" | "analysing" | "ready" | "failed";
export type RunStatus = "created" | "running" | "complete" | "partial" | "failed";

export interface PersonRecord {
  readonly id: string;
  readonly runId: string;
  readonly displayName?: string;
  readonly linkedinUrl: string;
  readonly instagramUrl: string;
  status: PersonStatus;
  error?: string;
  analysis?: PersonAnalysis;
  /** Computed once both sides exist. */
  matches?: readonly MatchScore[];
  sessions?: readonly DateSession[];
  createdAt: number;
}

export interface Run {
  readonly id: string;
  /** Marks the frozen, already-completed run used by /demo. */
  readonly isDemo: boolean;
  status: RunStatus;
  people: PersonRecord[];
  createdAt: number;
  updatedAt: number;
  /** Human-readable notes about degraded capability, e.g. no live ingest. */
  readonly notes?: readonly string[];
}
