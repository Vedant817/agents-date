import { NextResponse } from "next/server";
import { ConsentedTextAdapter } from "@/ingest/public";
import { buildAdapters, normaliseInstagramUrl, normaliseLinkedInUrl } from "@/ingest/setup";
import type { Run } from "@/core/types";
import {
  computeNetwork,
  emptyRun,
  hasSampleEntry,
  isSampleSubmission,
  newRunId,
  processPerson,
  summarise,
} from "@/pipeline/run";
import { getStore } from "@/store/runs";
import { rateLimit } from "@/api/rate-limit";
import { readEntries } from "./schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Send the run as JSON." }, { status: 415 });
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

  // Spend protection runs AFTER validation: rejecting a malformed request
  // must not burn the shared budget, or probing the form could lock out a
  // valid submit. Only a request that can actually create a run counts.
  const limit = rateLimit(request);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many runs started from this network in the last minute. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const store = getStore();
  const runId = newRunId();
  const notes: string[] = [];
  // The built-in example is accepted so the guided path works, but flagged so
  // the UI can label it instead of presenting synthetic profiles as a capture.
  // Each person is flagged individually: a run that mixes example and real
  // people must still mark the example ones.
  const isSample = isSampleSubmission(entries);
  const isMixed = !isSample && hasSampleEntry(entries);
  if (isSample || isMixed) {
    notes.push(
      isSample
        ? "This run used the built-in example personas, so the profiles are illustrative sample data rather than a real capture."
        : "This run mixes the built-in example personas with real links. The people marked as example are illustrative sample data, not a real capture.",
    );
  }
  if (!process.env.APIFY_TOKEN) {
    notes.push(
      "APIFY_TOKEN is not configured, so only pasted profile text could be read. Add the token to capture public profiles automatically.",
    );
  }

  const run: Run = { ...emptyRun(runId, false, notes), isSample: isSample || isMixed };
  run.status = "running";
  await store.save(run);

  const adapters = buildAdapters();
  const supplied = adapters.find((a): a is ConsentedTextAdapter => a instanceof ConsentedTextAdapter);
  entries.forEach((entry) => {
    if (!supplied) return;
    if (entry.linkedinText?.trim()) supplied.supply("linkedin", normaliseLinkedInUrl(entry.linkedin), entry.linkedinText);
    if (entry.instagramText?.trim()) supplied.supply("instagram", normaliseInstagramUrl(entry.instagram), entry.instagramText);
  });

  const people = [];
  for (const [i, entry] of entries.entries()) {
    const person = await processPerson(
      runId,
      { linkedin: entry.linkedin, instagram: entry.instagram, name: entry.name },
      adapters,
      `p${i + 1}`,
    );
    people.push(person);
  }

  const computed = computeNetwork(people);
  const finalRun: Run = {
    ...run,
    people: computed,
    status: computed.some((p) => p.status === "ready") ? "complete" : "failed",
  };
  const saved = await store.save(finalRun);

  return NextResponse.json({ runId: saved.id, summary: summarise(saved) }, { status: 201 });
}

// Runs are created with POST only. Answer other methods with JSON rather
// than Next's default empty 405, so API clients get a usable error.
function methodNotAllowed() {
  return NextResponse.json({ error: "Use POST to create a run." }, { status: 405 });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
