import type { ReadMode, SourceKind, SourcePair, SourceRecord } from "@/core/types";

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

/**
 * Adapters that read text off the platform itself, as opposed to recording
 * text the submitter pasted. Only these establish that this system actually
 * read the profile.
 */
const LIVE_PROVIDERS = new Set(["apify", "anonymous-web"]);

export function isLiveProvider(provider: string | undefined): boolean {
  return Boolean(provider && LIVE_PROVIDERS.has(provider));
}

/** Human-readable provenance for a captured source, used by the UI. */
export function provenanceLabel(record: SourceRecord | undefined): string {
  if (!record) return "no source";
  if (record.status === "unavailable") return "not read";
  if (record.readMode === "live") return "read live";
  if (record.readMode === "seeded") return "seeded sample";
  // Anything without a proven live read is treated as pasted. Claiming "live"
  // is the one thing this must never do without an adapter that earned it.
  return "pasted text";
}

/** True only when this system itself read the platform. */
export function isLiveRead(record: SourceRecord | undefined): boolean {
  return record?.status === "captured" && record.readMode === "live";
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
  /**
   * Defaults from the provider so an existing call site cannot accidentally
   * claim a live read. Only the known live adapters produce "live"; everything
   * else is treated as text this system did not read off the platform.
   */
  readMode?: ReadMode,
): SourceRecord {
  const clean = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (clean.length === 0) {
    return unavailable(kind, url, "The public profile returned no readable text.", provider);
  }
  return {
    kind,
    url,
    status: "captured",
    capturedAt: Date.now(),
    lines: clean,
    provider,
    readMode: readMode ?? (isLiveProvider(provider) ? "live" : "pasted"),
  };
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
