import { describe, expect, it } from "vitest";
import { captured, isLiveProvider, provenanceLabel, provenanceTag, unavailable } from "@/ingest/adapter";
import { ConsentedTextAdapter } from "@/ingest/public";

const URL = "https://www.instagram.com/ari.vance";

/**
 * A source record with status "captured" is not proof that this system read
 * the platform: the text may have been pasted by whoever started the run.
 * These tests pin the rule that only a live adapter earns the words "read
 * live", so no UI change can quietly promote pasted text into a verified
 * capture.
 */
describe("source provenance", () => {
  it("treats the known live adapters as a live read", () => {
    for (const provider of ["apify", "anonymous-web"]) {
      const record = captured("instagram", URL, ["bio line"], provider);
      expect(record.readMode).toBe("live");
      expect(provenanceLabel(record)).toBe("read live");
    }
  });

  it("never claims a live read for text this system did not fetch", () => {
    // An unrecognised provider must fail safe: "pasted text", not "read live".
    const record = captured("instagram", URL, ["bio line"], "some-new-adapter");
    expect(isLiveProvider("some-new-adapter")).toBe(false);
    expect(provenanceLabel(record)).toBe("pasted text");
  });

  it("records pasted text from the consented adapter as pasted, never live", async () => {
    const adapter = new ConsentedTextAdapter();
    adapter.supply("instagram", URL, "Display name\nBio\nA caption");
    const record = await adapter.capture({ kind: "instagram", url: URL, handle: "ari.vance" });
    expect(record.status).toBe("captured");
    expect(record.readMode).toBe("pasted");
    expect(provenanceLabel(record)).toBe("pasted text");
  });

  it("reports missing and unreadable sources instead of guessing", () => {
    expect(provenanceLabel(undefined)).toBe("no source");
    expect(provenanceLabel(unavailable("linkedin", "https://x.test", "HTTP 999", "anonymous-web"))).toBe("not read");
  });

  it("fails safe on citation tags: only live reads go untagged", () => {
    // provenanceTag is what transcript citations use. A live read needs no
    // tag; everything else is marked, so a quote can never read like a
    // platform capture it was not.
    expect(provenanceTag("live")).toBeNull();
    expect(provenanceTag("pasted")).toBe("pasted text");
    expect(provenanceTag(undefined)).toBeNull();
  });
});
