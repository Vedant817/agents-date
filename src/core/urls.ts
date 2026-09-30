import type { SourceKind } from "./types";

export interface ParseResult {
  readonly ok: boolean;
  readonly url?: string;
  readonly handle?: string;
  readonly error?: string;
}

const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com", "uk.linkedin.com", "in.linkedin.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "instagr.am", "m.instagram.com"]);

/**
 * Accepts a LinkedIn profile URL. We require the /in/<slug> shape because a
 * company or school page is not a person and must not silently enter the pool.
 */
export function parseLinkedIn(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "LinkedIn URL is empty." };

  // Tolerate a bare slug as a convenience, but normalise it to a real URL.
  const bare = /^[A-Za-z0-9._-]{2,100}$/.test(trimmed) && !trimmed.includes(".");
  const candidate = bare ? `https://www.linkedin.com/in/${trimmed}` : withScheme(trimmed);

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "That does not look like a valid URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Only https:// links are accepted." };
  }
  if (!LINKEDIN_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, error: "This is not a linkedin.com link." };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "in" || !segments[1]) {
    return {
      ok: false,
      error: "Use a personal profile link (linkedin.com/in/yourname), not a company or school page.",
    };
  }

  return {
    ok: true,
    url: `https://www.linkedin.com/in/${segments[1]}`,
    handle: segments[1],
  };
}

/**
 * Accepts a public Instagram profile. Rejects private-by-claim is not
 * possible here, so private accounts are caught later during capture; we only
 * reject non-profile URLs (reels, posts, explore) and obvious non-handles.
 */
export function parseInstagram(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Instagram URL is empty." };

  const bare = /^@?[A-Za-z0-9._]{1,30}$/.test(trimmed);
  const candidate = bare
    ? `https://www.instagram.com/${trimmed.replace(/^@/, "")}`
    : withScheme(trimmed);

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "That does not look like a valid URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Only https:// links are accepted." };
  }
  if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, error: "This is not an instagram.com link." };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (!first) {
    return { ok: false, error: "Add the username, e.g. instagram.com/yourname." };
  }
  if (["p", "reel", "reels", "explore", "stories", "tv", "accounts"].includes(first.toLowerCase())) {
    return { ok: false, error: "Link the profile itself, not a post, reel or explore page." };
  }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(first)) {
    return { ok: false, error: "That Instagram username contains unsupported characters." };
  }

  return { ok: true, url: `https://www.instagram.com/${first}`, handle: first };
}

export function parseSource(kind: SourceKind, input: string): ParseResult {
  return kind === "linkedin" ? parseLinkedIn(input) : parseInstagram(input);
}

function withScheme(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
