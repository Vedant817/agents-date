import { NextResponse } from "next/server";
import type { Run } from "@/core/types";
import { emptyRun, newRunId } from "@/pipeline/run";
import { startCreateRun } from "@/pipeline/background";
import { getStore } from "@/store/runs";
import { newManageToken } from "@/api/manage-token";
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
  if (!process.env.APIFY_TOKEN) {
    notes.push(
      "APIFY_TOKEN is not configured, so only pasted profile text could be read. Add the token to capture public profiles automatically.",
    );
  }

  // Ownership without accounts: the raw token goes back once, in this
  // response only. The server keeps the hash. Lose the token and nobody —
  // including us — can extend, list, unlist or delete the run.
  const { token: manageToken, hash: manageTokenHash } = newManageToken();
  const run: Run = { ...emptyRun(runId, notes), manageTokenHash };
  run.status = "running";
  await store.save(run);

  // The slow work — capture per person, then dating and ranking — runs in the
  // background. The client follows progress over SSE and opens the run when
  // it completes, instead of holding this connection open for the whole job.
  const started = startCreateRun(
    runId,
    entries.map((entry) => ({
      linkedin: entry.linkedin,
      instagram: entry.instagram,
      name: entry.name,
      linkedinText: entry.linkedinText,
      instagramText: entry.instagramText,
    })),
  );
  if (!started) {
    // Every slot is busy. Remove the running row so it never reads as a
    // stuck run, and ask the client to retry rather than queue silently.
    await store.delete(runId).catch(() => undefined);
    return NextResponse.json(
      { error: "The server is busy processing other runs. Try again in a few seconds." },
      { status: 429, headers: { "retry-after": "15" } },
    );
  }

  return NextResponse.json({ runId, manageToken }, { status: 202 });
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
