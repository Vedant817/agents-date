import { describe, expect, it } from "vitest";
import { parseInstagram, parseLinkedIn } from "@/core/urls";
import { captured, normaliseLines } from "@/ingest/adapter";
import { looksLikePlaceholder } from "@/ingest/public";

/**
 * The duplicate guard is only as good as the canonical URL. Handles are
 * case-insensitive on both platforms, so anything that keeps the raw case
 * would let the same person in twice, separately ranked, and dated against
 * themselves.
 */
describe("URL canonicalisation", () => {
  it("lowercases the LinkedIn handle so two spellings are one profile", () => {
    const lower = parseLinkedIn("linkedin.com/in/sturgeon");
    const upper = parseLinkedIn("https://www.LINKEDIN.com/in/Sturgeon");
    expect(lower.ok && upper.ok).toBe(true);
    expect(lower.url).toBe(upper.url);
    expect(lower.handle).toBe("sturgeon");
    expect(upper.handle).toBe("sturgeon");
  });

  it("lowercases the Instagram handle the same way", () => {
    const lower = parseInstagram("instagram.com/sturgeon");
    const upper = parseInstagram("https://www.Instagram.com/Sturgeon");
    expect(lower.ok && upper.ok).toBe(true);
    expect(lower.url).toBe(upper.url);
    expect(upper.handle).toBe("sturgeon");
  });

  it("accepts a capitalised path instead of calling it a company page", () => {
    // Regression: "LINKEDIN.COM/IN/QA-PERSON" was rejected with "use a personal
    // profile link, not a company or school page", which is a wrong diagnosis
    // of a plausible paste.
    const r = parseLinkedIn("LINKEDIN.COM/IN/QA-PERSON");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe("qa-person");
  });

  it("still rejects a company or school page", () => {
    expect(parseLinkedIn("https://www.linkedin.com/company/stripe").ok).toBe(false);
    expect(parseLinkedIn("https://www.linkedin.com/school/imperial").ok).toBe(false);
    expect(parseLinkedIn("https://www.linkedin.com/").ok).toBe(false);
  });

  it("still rejects Instagram posts, reels and reserved paths", () => {
    for (const url of [
      "https://www.instagram.com/p/Cabc123/",
      "https://www.instagram.com/reel/Cabc123/",
      "https://www.instagram.com/explore/",
      "https://www.instagram.com/accounts/login/",
    ]) {
      expect(parseInstagram(url).ok).toBe(false);
    }
  });

  it("treats an Instagram handle with invalid characters as invalid", () => {
    expect(parseInstagram("instagram.com/has-hyphen").ok).toBe(false);
    expect(parseInstagram("instagram.com/ok_name.1").ok).toBe(true);
  });

  it("keeps a trailing slash or query from changing the identity", () => {
    const plain = parseLinkedIn("https://www.linkedin.com/in/sturgeon");
    const slash = parseLinkedIn("https://www.linkedin.com/in/sturgeon/");
    expect(plain.url).toBe(slash.url);
  });
});

describe("capture normalisation", () => {
  it("collapses whitespace and drops empty lines, so a pasted block is stable", () => {
    const lines = normaliseLines(["  Trail   running  ", "", "   ", "Bouldering\tweekly"]);
    expect(lines).toEqual(["Trail running", "Bouldering weekly"]);
  });

  it("caps the number and length of lines", () => {
    const many = normaliseLines(Array.from({ length: 200 }, () => "x".repeat(400)));
    expect(many.length).toBe(60);
    expect(many.every((l) => l.length <= 220)).toBe(true);
  });

  it("treats empty text as an unavailable source, not a captured one", () => {
    const record = captured("instagram", "https://x.test", ["", "   "], "anonymous-web");
    expect(record.status).toBe("unavailable");
  });
});

describe("placeholder page detection", () => {
  it("catches the pages Instagram serves with a 200 for missing accounts", () => {
    expect(looksLikePlaceholder("<html>Sorry, this page isn't available</html>", ["Sorry, this page isn't available"])).toBe(true);
    expect(looksLikePlaceholder("<html>Log in to Instagram</html>", ["Log in to Instagram"])).toBe(true);
  });

  it("accepts a page that really has profile text", () => {
    const lines = ["Ari Vance", "Runner. Coffee obsessive.", "Six weeks to a sub-3 marathon."];
    expect(looksLikePlaceholder("<html>" + lines.join(" ") + "</html>", lines)).toBe(false);
  });
});
