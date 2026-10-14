import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { runDate } from "@/dating/engine";
import {
  EndpointParaphraser,
  IdentityParaphraser,
  verifyParaphrase,
  type ParaphraseEndpoint,
} from "@/dating/paraphrase";
import { analyse } from "@/analysis/analyse";
import type { DateSession, PersonAnalysis } from "@/core/types";

function analysis(id: string, name: string, lines: string[]): PersonAnalysis {
  return analyse(
    id,
    {
      linkedin: { kind: "linkedin", url: `l:${id}`, status: "captured", readMode: "pasted", lines },
      instagram: { kind: "instagram", url: `i:${id}`, status: "captured", readMode: "pasted", lines },
    },
    name,
  );
}

function session(): DateSession {
  const a = analysis("a", "Ari Vance", ["Ari Vance", "Engineer", "Trail running and bouldering at weekends."]);
  const b = analysis("b", "Bo Lindqvist", ["Bo Lindqvist", "Designer", "Trail running and natural wine."]);
  return runDate("run_x", a, b);
}

/** A fake model endpoint over local HTTP: scripted per test. */
function stubServer(
  handler: (turns: { seq: number; text: string }[]) => { status: number; body: unknown },
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        const { status, body } = handler(JSON.parse(raw).turns ?? []);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/paraphrase`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function httpEndpoint(url: string, key = "test-key"): ParaphraseEndpoint {
  return {
    async paraphraseTurns(turns) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ turns }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`endpoint ${res.status}`);
      const data = (await res.json()) as { turns?: { seq: number; text: string }[] };
      if (!Array.isArray(data.turns)) throw new Error("bad shape");
      return data.turns;
    },
  };
}

describe("paraphrase gate", () => {
  it("identity ships the session untouched and verifies clean", async () => {
    const original = session();
    const out = await new IdentityParaphraser().paraphrase(original);
    expect(out).toBe(original);
    expect(verifyParaphrase(original, out)).toEqual([]);
  });

  it("accepts well-formed replacements and keeps every citation byte-identical", async () => {
    const { url, close } = await stubServer((turns) => ({
      status: 200,
      body: { turns: turns.map((t) => ({ seq: t.seq, text: `[retold] ${t.text}` })) },
    }));
    try {
      const original = session();
      const out = await new EndpointParaphraser(httpEndpoint(url)).paraphrase(original);
      expect(verifyParaphrase(original, out)).toEqual([]);
      expect(out.turns[0]!.text.startsWith("[retold]")).toBe(true);
      // Evidence untouched even though the prose changed.
      expect(out.turns[0]!.evidence).toEqual(original.turns[0]!.evidence);
    } finally {
      await close();
    }
  });

  it("falls back per turn on missing, empty and duplicated replacements", async () => {
    const { url, close } = await stubServer((turns) => ({
      status: 200,
      body: {
        turns: [
          { seq: turns[0]!.seq, text: "  " },
          { seq: turns[1]!.seq, text: "good retelling" },
          { seq: turns[1]!.seq, text: "duplicate ignored" },
        ],
      },
    }));
    try {
      const original = session();
      const out = await new EndpointParaphraser(httpEndpoint(url)).paraphrase(original);
      expect(out.turns[0]!.text).toBe(original.turns[0]!.text);
      expect(out.turns[1]!.text).toBe("good retelling");
      expect(out.turns[2]!.text).toBe(original.turns[2]!.text);
      expect(verifyParaphrase(original, out)).toEqual([]);
    } finally {
      await close();
    }
  });

  it("falls back to the original session when the endpoint fails", async () => {
    const { url, close } = await stubServer(() => ({ status: 500, body: { error: "down" } }));
    try {
      const original = session();
      const out = await new EndpointParaphraser(httpEndpoint(url)).paraphrase(original);
      expect(out).toBe(original);
    } finally {
      await close();
    }
  });

  it("verifyParaphrase catches resequencing, role/move changes and evidence edits", () => {
    const original = session();
    const shuffled = {
      ...original,
      turns: [...original.turns].reverse().map((t, i) => ({ ...t, seq: i })),
    };
    expect(verifyParaphrase(original, shuffled).length).toBeGreaterThan(0);

    const roleSwap = {
      ...original,
      turns: original.turns.map((t) => ({ ...t, role: t.role === "A" ? ("B" as const) : ("A" as const) })),
    };
    expect(verifyParaphrase(original, roleSwap)).toContainEqual(expect.stringMatching(/role changed/));

    const evidenceEdit = {
      ...original,
      turns: original.turns.map((t, i) =>
        i === 0 ? { ...t, evidence: [...t.evidence, ...original.turns[1]!.evidence] } : t,
      ),
    };
    expect(verifyParaphrase(original, evidenceEdit)).toContainEqual(expect.stringMatching(/evidence altered/));

    const dropped = { ...original, turns: original.turns.slice(0, -1) };
    expect(verifyParaphrase(original, dropped)).toContainEqual(expect.stringMatching(/turn count changed/));
  });
});
