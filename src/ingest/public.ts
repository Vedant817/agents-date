import {
  captured,
  unavailable,
  type CaptureAdapter,
  type CaptureInput,
  normaliseLines,
} from "./adapter";
import type { SourceRecord } from "@/core/types";

/**
 * Credential-free capture.
 *
 * Verified behaviour of the live web, measured while building this:
 *  - Instagram returns HTTP 200 with a client-rendered shell containing no
 *    profile text; its JSON endpoint returns 401 without auth.
 *  - LinkedIn returns HTTP 999 (its bot-block code) for anonymous requests.
 *
 * So an anonymous adapter cannot invent data. Instead it accepts text the
 * profile OWNER has pasted (their own visible profile), which is consented and
 * keeps the "exactly two sources" contract intact: the source record still
 * points at the real profile URL, and the lines are what that profile shows.
 */
export class ConsentedTextAdapter implements CaptureAdapter {
  readonly name = "consented-text";
  readonly isLive = false;

  private readonly provided = new Map<string, string[]>();

  /** Registered text keyed by `${kind}:${url}`. */
  supply(kind: "linkedin" | "instagram", url: string, text: string): void {
    const lines = normaliseLines(text.split(/\r?\n/));
    this.provided.set(`${kind}:${url}`, lines);
  }

  has(kind: "linkedin" | "instagram", url: string): boolean {
    return this.provided.has(`${kind}:${url}`);
  }

  async capture(input: CaptureInput): Promise<SourceRecord> {
    const lines = this.provided.get(`${input.kind}:${input.url}`);
    if (lines && lines.length > 0) {
      return captured(input.kind, input.url, lines, "consented-text");
    }
    return unavailable(
      input.kind,
      input.url,
      input.kind === "linkedin"
        ? "LinkedIn blocks anonymous profile reads (HTTP 999). Add an Apify token, or paste the visible profile text."
        : "Instagram serves a JavaScript-only page to anonymous requests. Add an Apify token, or paste the visible profile text.",
      "consented-text",
    );
  }
}

/**
 * Attempts a plain anonymous read. Kept separate from the consented path so
 * the reason a profile is empty is always attributable and never silently
 * downgraded to a placeholder profile.
 */
export class AnonymousWebAdapter implements CaptureAdapter {
  readonly name = "anonymous-web";
  readonly isLive = true;

  async capture(input: CaptureInput): Promise<SourceRecord> {
    try {
      const res = await fetch(input.url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });

      if (input.kind === "linkedin") {
        // 999 is LinkedIn's documented bot-block response.
        return unavailable(
          "linkedin",
          input.url,
          `LinkedIn returned HTTP ${res.status}, which is its bot-block response for automated requests.`,
          "anonymous-web",
        );
      }

      if (!res.ok) {
        return unavailable("instagram", input.url, `HTTP ${res.status}.`, "anonymous-web");
      }

      const html = await res.text();
      const lines = extractPublicText(html);
      if (lines.length === 0) {
        return unavailable(
          "instagram",
          input.url,
          "Instagram returned only a client-rendered shell, with no profile text available to an anonymous reader.",
          "anonymous-web",
        );
      }
      return captured("instagram", input.url, lines, "anonymous-web");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return unavailable(input.kind, input.url, `Request failed: ${message}`, "anonymous-web");
    }
  }
}

/** Pull only clearly-labelled, human-readable meta text out of raw HTML. */
function extractPublicText(html: string): string[] {
  const lines: string[] = [];
  const pushMeta = (property: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "gi",
    );
    for (const m of html.matchAll(re)) {
      const v = m[1]?.trim();
      if (v) lines.push(v);
    }
  };
  for (const key of ["og:title", "og:description", "description", "twitter:title", "twitter:description"]) {
    pushMeta(key);
  }
  return normaliseLines(lines);
}
