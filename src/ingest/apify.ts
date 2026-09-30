import { captured, unavailable, type CaptureAdapter, type CaptureInput, normaliseLines } from "./adapter";
import type { SourceRecord } from "@/core/types";

const API = "https://api.apify.com/v2";

/**
 * Instagram Actor: official Apify actor, pay-per-event.
 * Free-plan price shown by the store at time of writing: $2.60 / 1,000 results.
 * Verify current pricing before enabling in production.
 */
const INSTAGRAM_ACTOR = "apify/instagram-profile-scraper";
/**
 * LinkedIn Actor: COMMUNITY actor (not built by Apify).
 *
 * IMPORTANT COMPLIANCE NOTE: LinkedIn's User Agreement s8.2 prohibits using
 * automated means to scrape or copy profile data without the content owner's
 * consent. This adapter exists so a deployment that HAS obtained the required
 * permission can operate, but it is OFF by default and must not be enabled for
 * arbitrary third-party URLs. See docs/PRIVACY.md.
 */
const LINKEDIN_ACTOR = "dev_fusion/linkedin-profile-scraper";

export interface ApifyAdapterOptions {
  readonly token: string;
  /** Hard cap on the maximum charge for a single capture, in USD. */
  readonly maxTotalChargeUsd: number;
  readonly enableLinkedIn?: boolean;
}

export class ApifyAdapter implements CaptureAdapter {
  readonly name = "apify";
  readonly isLive = true;

  constructor(private readonly opts: ApifyAdapterOptions) {}

  async capture(input: CaptureInput): Promise<SourceRecord> {
    const actor =
      input.kind === "instagram" ? INSTAGRAM_ACTOR : LINKEDIN_ACTOR;

    if (input.kind === "linkedin" && !this.opts.enableLinkedIn) {
      return unavailable(
        "linkedin",
        input.url,
        "LinkedIn capture is disabled: it requires the profile owner's permission under LinkedIn's User Agreement. Use the LinkedIn sign-in flow or paste consented profile text.",
        "apify",
      );
    }

    const body =
      input.kind === "instagram"
        ? { usernames: [input.handle], includeAboutSection: false }
        : { profileUrls: [input.url] };

    try {
      // maxTotalChargeUsd must be a QUERY PARAM, not part of the input body.
      const res = await fetch(
        `${API}/acts/${encodeURIComponent(actor)}/runs?waitForFinish=60&maxTotalChargeUsd=${this.opts.maxTotalChargeUsd}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.opts.token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        },
      );

      if (res.status === 402) {
        return unavailable("instagram", input.url, "Apify account needs more credit for this run.", "apify");
      }
      if (!res.ok) {
        return unavailable(input.kind, input.url, `Apify returned HTTP ${res.status}.`, "apify");
      }

      const run = (await res.json()) as {
        data: { status: string; statusMessage?: string; defaultDatasetId: string };
      };

      if (run.data.status !== "SUCCEEDED") {
        const msg = run.data.statusMessage ?? run.data.status;
        return unavailable(input.kind, input.url, `Apify run ${run.data.status}: ${msg}`, "apify");
      }

      const itemsRes = await fetch(`${API}/datasets/${run.data.defaultDatasetId}/items?clean=1&limit=1`, {
        headers: { authorization: `Bearer ${this.opts.token}` },
        signal: AbortSignal.timeout(45_000),
      });
      if (!itemsRes.ok) {
        return unavailable(input.kind, input.url, "Apify dataset could not be read.", "apify");
      }

      const items = (await itemsRes.json()) as Record<string, unknown>[];
      const first = items[0];
      if (!first) return unavailable(input.kind, input.url, "Apify returned no result for this profile.", "apify");

      return captured(input.kind, input.url, extractLines(input.kind, first), "apify");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return unavailable(input.kind, input.url, `Apify request failed: ${message}`, "apify");
    }
  }
}

/** Flatten an actor record into the short lines an agent may reason over. */
function extractLines(kind: "instagram" | "linkedin", record: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) lines.push(v.trim());
  };

  if (kind === "instagram") {
    push(record.fullName);
    push(record.biography);
    if (typeof record.externalUrl === "string") lines.push(`link: ${record.externalUrl}`);
    const posts = record.latestPosts;
    if (Array.isArray(posts)) {
      for (const post of posts.slice(0, 12)) {
        if (post && typeof post === "object") {
          const caption = (post as Record<string, unknown>).caption;
          if (typeof caption === "string") lines.push(caption);
        }
      }
    }
  } else {
    push(record.fullName);
    push(record.headline);
    const about = record.about;
    if (typeof about === "string") lines.push(about);
    const experiences = record.experiences;
    if (Array.isArray(experiences)) {
      for (const exp of experiences.slice(0, 5)) {
        if (exp && typeof exp === "object") {
          const e = exp as Record<string, unknown>;
          const role = [e.title, e.companyName].filter(Boolean).join(" at ");
          if (role) lines.push(role);
          push(e.jobDescription);
        }
      }
    }
    const skills = record.skills;
    if (Array.isArray(skills)) {
      for (const s of skills.slice(0, 20)) {
        if (typeof s === "string") lines.push(s);
        else if (s && typeof s === "object") {
          const t = (s as Record<string, unknown>).title;
          if (typeof t === "string") lines.push(t);
        }
      }
    }
  }

  return normaliseLines(lines);
}
