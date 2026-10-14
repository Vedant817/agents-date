import { describe, expect, it, beforeEach } from "vitest";
import { POST as create } from "@/app/api/runs/route";
import { GET as events } from "@/app/api/runs/[runId]/events/route";
import { resetRateLimit } from "@/api/rate-limit";
import { snapshot, startCreateRun, startExtendRun, subscribe, waitForRun } from "@/pipeline/background";
import type { ProgressEvent } from "@/pipeline/background";
import { getStore } from "@/store/runs";
import { emptyRun, newRunId } from "@/pipeline/run";

function post(body: unknown) {
  return new Request("https://x.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const people2 = [
  {
    name: "Ari Vance",
    linkedin: "linkedin.com/in/ari-vance",
    instagram: "instagram.com/ari.vance",
    linkedinText: "Ari Vance\nProduct engineer\nTrail running and bouldering at weekends.",
    instagramText: "Ari Vance\nRunner. Coffee obsessive.",
  },
  {
    name: "Bo Lindqvist",
    linkedin: "linkedin.com/in/bo-lindqvist",
    instagram: "instagram.com/bo.lindqvist",
    linkedinText: "Bo Lindqvist\nProduct designer\nTrail running and natural wine.",
    instagramText: "Bo Lindqvist\nTrail runner. Natural wine.",
  },
];

describe("background run processing", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("emits one started/done pair per person, then dates, then complete", async () => {
    // Subscribe BEFORE the job starts: the first person-started fires
    // synchronously inside job kickoff, so subscribing after POST would miss
    // it. The browser has the same property, which is why the SSE endpoint
    // always replays a snapshot first.
    const store = getStore();
    const runId = newRunId();
    await store.save({ ...emptyRun(runId), status: "running" });
    const seen: ProgressEvent[] = [];
    const unsub = subscribe(runId, (evt) => seen.push(evt));
    startCreateRun(runId, people2);
    await waitForRun(runId);
    // Let the terminal emission flush through the listener.
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsub();

    const types = seen.map((e) => e.type);
    expect(types.filter((t) => t === "person-started")).toHaveLength(2);
    expect(types.filter((t) => t === "person-done")).toHaveLength(2);
    expect(types).toContain("dates");
    expect(types[types.length - 1]).toBe("complete");
    const done = seen.find((e) => e.type === "complete")!;
    expect(done.ready).toBe(2);
    expect(done.sessions).toBeGreaterThan(0);
  });

  it("saves people incrementally, so a mid-run read shows progress", async () => {
    const res = await create(post({ entries: people2 }));
    const runId = ((await res.json()) as { runId: string }).runId;
    // Do not await the job: read whatever state exists right now. The only
    // assertion is structural — the run exists and is running.
    const store = getStore();
    const run = await store.get(runId);
    expect(run).not.toBeNull();
    expect(["running", "complete"]).toContain(run!.status);
    await waitForRun(runId);
    const finished = await store.get(runId);
    expect(finished!.status).toBe("complete");
  });

  it("snapshot reports a finished run as complete with its totals", async () => {
    const res = await create(post({ entries: people2 }));
    const runId = ((await res.json()) as { runId: string }).runId;
    await waitForRun(runId);
    const snap = await snapshot(runId);
    expect(snap.type).toBe("complete");
    expect(snap.done).toBe(2);
    expect(snap.ready).toBe(2);
  });

  it("snapshot answers an unknown run as failed, not a hang", async () => {
    const snap = await snapshot("run_nope_missing");
    expect(snap.type).toBe("failed");
  });

  it("snapshot stays live while an extend job runs on a complete run", async () => {
    // Regression with real user impact: extending a finished run, then
    // opening the event stream, replayed the OLD completion instantly. The
    // stream closed, the client moved on, and the new person had not landed
    // yet. While a job is active the snapshot must be live, whatever the
    // stored status says.
    const res = await create(post({ entries: people2 }));
    const runId = ((await res.json()) as { runId: string }).runId;
    await waitForRun(runId);
    expect((await snapshot(runId)).type).toBe("complete");

    startExtendRun(runId, [
      {
        linkedin: "linkedin.com/in/c",
        instagram: "instagram.com/c",
        linkedinText: "C Example\nDesigner.",
        instagramText: "C Example\nDesigner.",
      },
    ], 3);
    const mid = await snapshot(runId);
    expect(mid.type).toBe("snapshot");
    expect(mid.total).toBe(3);

    await waitForRun(runId);
    const done = await snapshot(runId);
    expect(done.type).toBe("complete");
    expect(done.done).toBe(3);
  });

  it("startCreateRun marks the run failed when capture throws everything away", async () => {
    // No pasted text and no network in tests: nobody is readable.
    const store = getStore();
    const runId = newRunId();
    await store.save({ ...emptyRun(runId), status: "running" });
    startCreateRun(runId, [
      { linkedin: "linkedin.com/in/ghost-one", instagram: "instagram.com/ghost.one" },
    ]);
    await waitForRun(runId);
    const run = await store.get(runId);
    expect(run!.status).toBe("failed");
  });
});

describe("GET /api/runs/<runId>/events (SSE)", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("streams event-stream content ending in a complete event", async () => {
    const res = await create(post({ entries: people2 }));
    const runId = ((await res.json()) as { runId: string }).runId;
    await waitForRun(runId);

    const stream = await events(new Request(`https://x.test/api/runs/${runId}/events`), {
      params: Promise.resolve({ runId }),
    });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const body = await stream.text();
    expect(body).toMatch(/event: complete\n/);
    expect(body).toMatch(/"ready":2/);
  });

  it("answers an unknown run with 404, not a hanging stream", async () => {
    const stream = await events(new Request("https://x.test/api/runs/run_nope_missing/events"), {
      params: Promise.resolve({ runId: "run_nope_missing" }),
    });
    expect(stream.status).toBe(404);
  });
});
