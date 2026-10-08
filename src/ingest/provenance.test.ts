import { describe, expect, it } from "vitest";
import { captured, isLiveProvider, provenanceLabel, unavailable } from "@/ingest/adapter";
import { ConsentedTextAdapter } from "@/ingest/public";
import type { SourceRecord } from "@/core/types";

const URL = "https://www.instagram.com/example.runner";

/**
 * A source record with status "captured" is not proof that this system read
 * the platform: the text may have been pasted by whoever started the run, or
 * authored by the demo seed. These tests pin the rule that only a live
 * adapter earns the words "read live", so no UI change can quietly promote
 * pasted text into a verified capture.
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
    const record = await adapter.capture({ kind: "instagram", url: URL, handle: "example.runner" });
    expect(record.status).toBe("captured");
    expect(record.readMode).toBe("pasted");
    expect(provenanceLabel(record)).toBe("pasted text");
  });

  it("labels an authored seeded source as seeded sample data", () => {
    const record: SourceRecord = {
      kind: "linkedin",
      url: "https://www.linkedin.com/in/demo",
      status: "captured",
      capturedAt: 1,
      provider: "demo-seed",
      readMode: "seeded",
    };
    expect(provenanceLabel(record)).toBe("seeded sample");
  });

  it("reports missing and unreadable sources instead of guessing", () => {
    expect(provenanceLabel(undefined)).toBe("no source");
    expect(provenanceLabel(unavailable("linkedin", "https://x.test", "HTTP 999", "anonymous-web"))).toBe("not read");
  });
});
