import { ApifyAdapter } from "@/ingest/apify";
import { AnonymousWebAdapter, ConsentedTextAdapter } from "@/ingest/public";
import type { CaptureAdapter } from "@/ingest/adapter";

/**
 * Adapter order matters: try the strongest source of truth first, then fall
 * back. The consented-text adapter is always last so that a genuine automated
 * capture is never shadowed by pasted text.
 */
export function buildAdapters(): CaptureAdapter[] {
  const adapters: CaptureAdapter[] = [];
  const token = process.env.APIFY_TOKEN;
  if (token) {
    // enableLinkedIn is intentionally NOT set. LinkedIn automation requires the
    // profile owner's permission, which a public URL does not imply.
    adapters.push(
      new ApifyAdapter({
        token,
        maxTotalChargeUsd: Number(process.env.APIFY_MAX_CHARGE_USD ?? 0.5),
      }),
    );
  }
  adapters.push(new AnonymousWebAdapter());
  adapters.push(new ConsentedTextAdapter());
  return adapters;
}

export function normaliseLinkedInUrl(url: string): string {
  const m = url.trim().match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m?.[1] ? `https://www.linkedin.com/in/${m[1]}` : url.trim();
}

export function normaliseInstagramUrl(url: string): string {
  const m = url.trim().match(/instagram\.com\/([^/?#]+)/i);
  return m?.[1] ? `https://www.instagram.com/${m[1]}` : url.trim();
}
