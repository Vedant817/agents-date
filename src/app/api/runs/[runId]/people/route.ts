import { NextResponse } from "next/server";
import { ConsentedTextAdapter } from "@/ingest/public";
import { buildAdapters, normaliseInstagramUrl, normaliseLinkedInUrl } from "@/ingest/setup";
import type { Run } from "@/core/types";
import { computeNetwork, processPerson, summarise, validateSubmission, DEMO_RUN_ID } from "@/pipeline/run";
import { getStore } from "@/store/runs";
import { rateLimit } from "@/api/rate-limit";
import { MAX_PEOPLE, readEntries } from "../../schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Adds people to a run that already exists.
 *
 * The run page's only route back to the form was / which started a brand-new
 * run, so "Add more people" silently threw away everything the user had
 * already captured: their profiles, their dates and their rankings. Extending
 * re-reads the stored run, captures only the new people, and recomputes the
 * network over all of them, so existing people keep their analysis and gain
 * the new dates and the new ranking entries their extra partners create.
 */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Send the new people as JSON." }, { status: 415 });
  }

  const { runId } = await context.params;

  // The demo is served from a committed file, not the store, so a normal
  // lookup would report 404 and blame the link. Answer the well-known id
  // directly instead: it exists, it is just not extendable.
  if (runId === DEMO_RUN_ID) {
    return NextResponse.json(
      { error: "The demo run is a fixed example and cannot be extended. Start your own run instead." },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = readEntries(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message, issues: parsed.issues }, { status: 400 });
  }
  const entries = parsed.entries;

  const store = getStore();
  let existing: Run | null;
  try {
    existing = await store.get(runId);
  } catch (error) {
    // A corrupt or unreadable run is a server-side problem, not a 404.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run could not be read." },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }
  // The demo is a committed, frozen artefact. Extending it would rewrite a
  // file the repository ships, so every visitor would see a different demo.
  if (existing.isDemo) {
    return NextResponse.json(
      { error: "The demo run is a fixed example and cannot be extended. Start your own run instead." },
      { status: 400 },
    );
  }

  // The cap applies to the whole run, not to the batch: extending by 20 when
  // 15 already exist must fail here rather than silently dropping people.
  const kept = existing.people.filter((p) => p.status !== "failed" || p.analysis);
  const room = MAX_PEOPLE - kept.length;
  if (room <= 0) {
    return NextResponse.json(
      { error: `This run already has ${kept.length} people, which is the limit. Start a new run to add more.` },
      { status: 400 },
    );
  }
  if (entries.length > room) {
    return NextResponse.json(
      {
        error: `This run already has ${kept.length} people, so only ${room} more can be added. Remove some people and try again.`,
      },
      { status: 400 },
    );
  }

  // Validate against the whole run, not just the new batch, so a profile that
  // is already in the run is rejected instead of duplicated.
  const combined = [
    ...existing.people.map((p) => ({ linkedin: p.linkedinUrl, instagram: p.instagramUrl })),
    ...entries.map((e) => ({ linkedin: e.linkedin, instagram: e.instagram })),
  ];
  const issues = validateSubmission(combined).map((i) => ({
    // Re-index the issues that belong to the new batch.
    ...i,
    index: i.index - existing.people.length,
    message:
      i.index < existing.people.length
        ? i.message
        : i.message.replace(/entry (\d+)/i, (_, n: string) => `entry ${Number(n) - existing.people.length}`),
  })).filter((i) => i.index >= 0);
  if (issues.length > 0) {
    return NextResponse.json({ error: "Some links are not usable.", issues }, { status: 400 });
  }

  const limit = rateLimit(request);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many runs started from this network in the last minute. Try again in ${limit.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const adapters = buildAdapters();
  const supplied = adapters.find((a): a is ConsentedTextAdapter => a instanceof ConsentedTextAdapter);
  entries.forEach((entry) => {
    if (!supplied) return;
    if (entry.linkedinText?.trim()) supplied.supply("linkedin", normaliseLinkedInUrl(entry.linkedin), entry.linkedinText);
    if (entry.instagramText?.trim()) supplied.supply("instagram", normaliseInstagramUrl(entry.instagram), entry.instagramText);
  });

  // Continue the person numbering so ids stay unique inside the run.
  const firstIndex = existing.people.length + 1;
  const added = [];
  for (const [i, entry] of entries.entries()) {
    added.push(
      await processPerson(
        runId,
        { linkedin: entry.linkedin, instagram: entry.instagram, name: entry.name },
        adapters,
        `p${firstIndex + i}`,
      ),
    );
  }

  // Recompute across everyone, not just the new people, so the existing
  // profiles gain the new candidates in their own rankings and the new dates
  // show up on their profile pages too.
  const recomputed = computeNetwork([...existing.people, ...added]);
  const notes = new Set([
    ...(existing.notes ?? []),
    `Extended with ${added.filter((p) => p.status === "ready").length} more ${added.length === 1 ? "person" : "people"}.`,
  ]);
  const finalRun: Run = {
    ...existing,
    people: recomputed,
    notes: [...notes],
    status: recomputed.some((p) => p.status === "ready") ? "complete" : existing.status,
  };
  const saved = await store.save(finalRun);

  return NextResponse.json({ runId: saved.id, summary: summarise(saved), added: added.length }, { status: 200 });
}
