import { ApifyAdapter } from "@/ingest/apify";
import { AnonymousWebAdapter, ConsentedTextAdapter } from "@/ingest/public";
import type { CaptureAdapter } from "@/ingest/adapter";
import { parseInstagram, parseLinkedIn } from "@/core/urls";

/**
 * Adapter order matters: try the strongest source of truth first, then fall
 * back. The consented-text adapter is always last so that a genuine automated
 * capture is never shadowed by pasted text.
 */
export function buildAdapters(): CaptureAdapter[] {
  const adapters: CaptureAdapter[] = [];
  const token = process.env.APIFY_TOKEN;
  if (token) {
    adapters.push(
      new ApifyAdapter({
        token,
        // Guarded: an empty or unparseable env var must not silently disable
        // the spend cap (Number("") === 0) or send NaN in the query string.
        maxTotalChargeUsd: parseCharge(process.env.APIFY_MAX_CHARGE_USD, 0.5),
      }),
    );
  }
  adapters.push(new AnonymousWebAdapter());
  adapters.push(new ConsentedTextAdapter());
  return adapters;
}

/** Parse a charge cap safely; never return 0, NaN, or a negative number. */
export function parseCharge(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Hard ceiling: one capture must never be able to cost meaningful money.
  return Math.min(n, 2);
}

/**
 * Canonicalise a submitted URL to the SAME form the pipeline will look up.
 *
 * Previously these used a loose regex while the pipeline used the strict
 * parser, so `nasa`, `@nasa` and `instagr.am/nasa` all stored pasted text under
 * a key the pipeline never asked for. The user's text was silently ignored and
 * they were told to paste it again.
 */
export function normaliseLinkedInUrl(url: string): string {
  return parseLinkedIn(url).url ?? url.trim();
}

export function normaliseInstagramUrl(url: string): string {
  return parseInstagram(url).url ?? url.trim();
}
