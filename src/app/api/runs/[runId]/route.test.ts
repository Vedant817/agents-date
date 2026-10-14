import { describe, expect, it, beforeEach } from "vitest";
import { DELETE, GET } from "./route";
import { POST as visibility } from "./visibility/route";
import { POST as create } from "../route";
import { resetRateLimit } from "@/api/rate-limit";
import { waitForRun } from "@/pipeline/background";
import { getStore } from "@/store/runs";

const text = (name: string) => ({
  linkedinText: [`${name} Example`, "Engineer at a scale-up", "Trail running at weekends."].join("\n"),
  instagramText: [`${name} Example`, "Runner. Coffee obsessive."].join("\n"),
});

function runPost(body: unknown) {
  return new Request("https://x.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true, adult: true, ...(body as object) }),
  });
}

async function createRun(): Promise<{ runId: string; manageToken: string }> {
  const res = await create(
    runPost({
      entries: [
        { linkedin: "linkedin.com/in/a", instagram: "instagram.com/a", ...text("A") },
        { linkedin: "linkedin.com/in/b", instagram: "instagram.com/b", ...text("B") },
      ],
    }),
  );
  expect(res.status).toBe(202);
  const body = (await res.json()) as { runId: string; manageToken: string };
  await waitForRun(body.runId);
  return body;
}

const params = (runId: string) => ({ params: Promise.resolve({ runId }) });

function visibilityPost(runId: string, body: unknown) {
  return visibility(
    new Request(`https://x.test/api/runs/${runId}/visibility`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(runId),
  );
}

function deleteReq(runId: string, body: unknown) {
  return DELETE(
    new Request(`https://x.test/api/runs/${runId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(runId),
  );
}

describe("run ownership (manage token)", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("never serves the token hash", async () => {
    const { runId } = await createRun();
    const res = await GET(new Request(`https://x.test/api/runs/${runId}`), params(runId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: Record<string, unknown> };
    expect(body.run).not.toHaveProperty("manageTokenHash");
    expect(body.run).not.toHaveProperty("manageToken");
  });

  it("stores only the hash, never the token", async () => {
    const { runId, manageToken } = await createRun();
    const store = getStore();
    const saved = await store.get(runId);
    expect(saved?.manageTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved)).not.toContain(manageToken);
  });

  it("refuses deletion without the token, and deletes with it", async () => {
    const { runId, manageToken } = await createRun();

    const anon = await deleteReq(runId, {});
    expect(anon.status).toBe(403);
    expect((await anon.json()).error).toMatch(/manage token/i);

    const wrong = await deleteReq(runId, { manageToken: "0".repeat(64) });
    expect(wrong.status).toBe(403);

    const good = await deleteReq(runId, { manageToken });
    expect(good.status).toBe(200);
    expect((await good.json()).deleted).toBe(true);

    const store = getStore();
    expect(await store.get(runId)).toBeNull();
  });

  it("lists and unlists only with the token", async () => {
    const { runId, manageToken } = await createRun();

    // Unlisted by default: creatable and openable, invisible to the gallery.
    const store = getStore();
    expect((await store.get(runId))?.listed ?? false).toBe(false);

    const anon = await visibilityPost(runId, { listed: true, manageToken: "nope" });
    expect(anon.status).toBe(403);

    const list = await visibilityPost(runId, { listed: true, manageToken });
    expect(list.status).toBe(200);
    expect((await list.json()).listed).toBe(true);
    expect((await store.get(runId))?.listed).toBe(true);

    const unlist = await visibilityPost(runId, { listed: false, manageToken });
    expect(unlist.status).toBe(200);
    expect((await store.get(runId))?.listed).toBe(false);
  });

  it("the gallery shows only listed runs", async () => {
    const first = await createRun();
    const second = await createRun();
    await visibilityPost(second.runId, { listed: true, manageToken: second.manageToken });

    const store = getStore();
    const listed = (await store.list()).filter((r) => r.listed === true).map((r) => r.id);
    expect(listed).toContain(second.runId);
    expect(listed).not.toContain(first.runId);
  });
});
