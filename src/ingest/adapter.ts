import type { SourceKind, SourcePair, SourceRecord } from "@/core/types";

/**
 * What a capture adapter must return. Deliberately allows failure: a source
 * that cannot be read returns status "unavailable" with a reason, and the
 * pipeline records the gap instead of inventing content for it.
 */
export interface CaptureInput {
  readonly kind: SourceKind;
  readonly url: string;
  readonly handle: string;
}

export interface CaptureAdapter {
  readonly name: string;
  /** True when the adapter can run without user-supplied credentials. */
  readonly isLive: boolean;
  capture(input: CaptureInput): Promise<SourceRecord>;
}

export function unavailable(
  kind: SourceKind,
  url: string,
  reason: string,
  provider: string,
): SourceRecord {
  return {
    kind,
    url,
    status: "unavailable",
    capturedAt: Date.now(),
    reason,
    provider,
  };
}

export function captured(
  kind: SourceKind,
  url: string,
  lines: readonly string[],
  provider: string,
): SourceRecord {
  const clean = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (clean.length === 0) {
    return unavailable(kind, url, "The public profile returned no readable text.", provider);
  }
  return { kind, url, status: "captured", capturedAt: Date.now(), lines: clean, provider };
}

/**
 * Trims capture output to what an agent is allowed to reason from: a bounded
 * number of short lines. This also keeps prompt size predictable when an LLM
 * adapter is enabled.
 */
export function normaliseLines(lines: readonly string[], max = 60, maxLen = 220): string[] {
  return lines
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .slice(0, max)
    .map((l) => (l.length > maxLen ? `${l.slice(0, maxLen - 1)}…` : l));
}
