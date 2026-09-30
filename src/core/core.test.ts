import { describe, expect, it } from "vitest";
import { parseInstagram, parseLinkedIn, parseSource } from "./urls";
import { matchLine, allTraitKeys, getTrait } from "./taxonomy";
import { classifyLine } from "@/analysis/classify";
import { parseCharge } from "@/ingest/setup";

describe("classifyLine", () => {
  it("does not give unmatched prose the highest confidence kind", () => {
    // Regression: the LinkedIn fallthrough returned "skill" (0.92), so any
    // unrecognised line outranked an explicit "about" section (0.64).
    const long = "Some quite long reflective sentence about work and life that nobody classified.";
    expect(classifyLine(long, "linkedin", 6).kind).not.toBe("skill");
  });

  it("only reads a location from an explicit statement", () => {
    // Regression: "Pasta, it" matched the old /word, XX$/ pattern.
    expect(classifyLine("Pasta, it", "instagram", 3).kind).not.toBe("location");
    expect(classifyLine("Based in Glasgow", "instagram", 2).kind).toBe("location");
  });
});

describe("parseCharge", () => {
  it("falls back rather than disabling the cap", () => {
    // Number("") === 0 would silently remove the spend ceiling.
    expect(parseCharge("", 0.5)).toBe(0.5);
    expect(parseCharge(undefined, 0.5)).toBe(0.5);
    expect(parseCharge("abc", 0.5)).toBe(0.5);
    expect(parseCharge("NaN", 0.5)).toBe(0.5);
    expect(parseCharge("-3", 0.5)).toBe(0.5);
  });

  it("accepts a sane value and clamps a dangerous one", () => {
    expect(parseCharge("0.25", 0.5)).toBe(0.25);
    expect(parseCharge("1000", 0.5)).toBe(2);
  });
});

describe("parseLinkedIn", () => {
  it("normalises a full profile URL", () => {
    const r = parseLinkedIn("https://www.linkedin.com/in/williamhgates/");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://www.linkedin.com/in/williamhgates");
  });

  it("accepts a bare slug", () => {
    const r = parseLinkedIn("williamhgates");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://www.linkedin.com/in/williamhgates");
  });

  it("rejects a company page with a useful reason", () => {
    const r = parseLinkedIn("https://www.linkedin.com/company/apple");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/personal profile/i);
  });

  it("rejects a lookalike domain", () => {
    const r = parseLinkedIn("https://linkedin.com.evil.test/in/someone");
    expect(r.ok).toBe(false);
  });

  it("rejects non-https", () => {
    expect(parseLinkedIn("http://www.linkedin.com/in/someone").ok).toBe(false);
  });

  it("rejects empty", () => {
    expect(parseLinkedIn("   ").ok).toBe(false);
  });
});

describe("parseInstagram", () => {
  it("normalises a profile URL", () => {
    const r = parseInstagram("https://www.instagram.com/nasa/");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://www.instagram.com/nasa");
    expect(r.handle).toBe("nasa");
  });

  it("accepts a bare handle with or without @", () => {
    expect(parseInstagram("nasa").url).toBe("https://www.instagram.com/nasa");
    expect(parseInstagram("@nasa").url).toBe("https://www.instagram.com/nasa");
  });

  it("rejects a post URL", () => {
    const r = parseInstagram("https://instagram.com/p/DNQuxufAih9/");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/profile itself/i);
  });

  it("rejects a reel URL", () => {
    expect(parseInstagram("https://instagram.com/reel/abc123").ok).toBe(false);
  });

  it("rejects a lookalike domain", () => {
    expect(parseInstagram("https://instagram.com.evil.test/nasa").ok).toBe(false);
  });
});

describe("parseSource dispatch", () => {
  it("routes to the right parser", () => {
    expect(parseSource("linkedin", "https://linkedin.com/in/a").ok).toBe(true);
    expect(parseSource("instagram", "https://instagram.com/a").ok).toBe(true);
  });
});

describe("taxonomy", () => {
  it("has no duplicate keys", () => {
    const keys = allTraitKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every trait a label and category", () => {
    for (const key of allTraitKeys()) {
      const t = getTrait(key);
      expect(t?.label, key).toBeTruthy();
      expect(t?.category, key).toBeTruthy();
    }
  });

  it("prefers the longer phrase over a substring", () => {
    const hits = matchLine("I love trail running at weekends");
    const keys = hits.map((h) => h.def.key);
    expect(keys).toContain("hobby:trail-running");
  });

  it("respects word boundaries instead of substring matching", () => {
    // "art" must not fire inside "start", and "ipa" not inside "participate".
    const hits = matchLine("I participate in startups early");
    const keys = hits.map((h) => h.def.key);
    expect(keys).not.toContain("interest:art-galleries");
    expect(keys).not.toContain("interest:craft-beer");
  });

  it("matches multiple distinct traits in one line", () => {
    const keys = matchLine("Climbing, photography and natural wine on weekends").map(
      (h) => h.def.key,
    );
    expect(keys).toContain("hobby:climbing");
    expect(keys).toContain("hobby:photography");
    expect(keys).toContain("interest:wine");
  });

  it("returns nothing for unremarkable text", () => {
    expect(matchLine("Currently a product manager at a mid-size company")).toHaveLength(0);
  });

  it("does not match ambiguous single words that are not the hobby", () => {
    // Regression: these produced confident nonsense from ordinary prose.
    // "Events engineer at Google" claimed community-building as a value.
    const cases: [string, string][] = [
      ["Events engineer at Google", "value:community-building"],
      ["Made $10k last quarter", "hobby:running"],
      ["Hey sup, long time", "hobby:surfing"],
      ["Currently boarding a flight", "hobby:skiing"],
      ["Raised a band-aid on the build", "hobby:music"],
      ["We rely on plants in the office", "hobby:gardening"],
      ["Pasta, it", "interest:theatre"],
    ];
    for (const [line, key] of cases) {
      const keys = matchLine(line).map((h) => h.def.key);
      expect(keys, `"${line}" must not claim ${key}`).not.toContain(key);
    }
  });

  it("counts one phrase as one trait, not a trait plus its parent", () => {
    const keys = matchLine("I love trail running").map((h) => h.def.key);
    expect(keys).toContain("hobby:trail-running");
    expect(keys, "trail running is one hobby, not also generic running").not.toContain("hobby:running");
  });
});
