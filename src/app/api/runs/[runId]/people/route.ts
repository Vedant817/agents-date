import { NextResponse } from "next/server";
import { normaliseInstagramUrl, normaliseLinkedInUrl } from "@/ingest/setup";
import type { Run } from "@/core/types";
import { SHOWCASE_RUN_ID } from "@/pipeline/run";
import { startExtendRun } from "@/pipeline/background";
import { getStore } from "@/store/runs";
import { verifyToken } from "@/api/manage-token";
import { RATE_ACTIONS, rateLimit } from "@/api/rate-limit";
import { MAX_PEOPLE, manageTokenFrom, readEntries } from "../../schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Send the new people as JSON." }, { status: 415 });
  }

  const { runId } = await context.params;

  // The showcase is a committed file, not a stored run, so a normal lookup
  // would report 404 and blame the link. Answer the well-known id directly
  // instead: it exists, it is just not extendable.
  if (runId === SHOWCASE_RUN_ID) {
    return NextResponse.json(
      { error: "The showcase run is a fixed example and cannot be extended. Start your own run instead." },
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

  // An early read so a bad or expired run is refused before any capture
  // spends money or time. The authoritative read happens under the lock,
  // below, because the run can change between here and there.
  let existing: Run | null;
  try {
    existing = await store.get(runId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run could not be read." },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }

  // Ownership: anyone could otherwise add strangers to anyone's run. Runs
  // that carry a manage-token hash require the token; pre-token runs stay
  // open (documented in manage-token.ts).
  if (existing.manageTokenHash) {
    const token = manageTokenFrom(raw);
    if (!token || !verifyToken(token, existing.manageTokenHash)) {
      return NextResponse.json(
        { error: "This run is managed. Provide its manage token to add people." },
        { status: 403 },
      );
    }
  }

  // Every stored person counts against the cap, not just the readable ones.
  // Counting only readable people let a run with many unreadable links past
  // the 20-person limit, because the unreadable ones were not counted.
  if (existing.people.length > MAX_PEOPLE) {
    // Should be unreachable; refuse loudly rather than growing the run further.
    return NextResponse.json(
      { error: `This run already has ${existing.people.length} people. Start a new run to add more.` },
      { status: 400 },
    );
  }
  const room = MAX_PEOPLE - existing.people.length;
  if (room <= 0) {
    return NextResponse.json(
      { error: `This run already has ${MAX_PEOPLE} people, which is the limit. Start a new run to add more.` },
      { status: 400 },
    );
  }
  if (entries.length > room) {
    return NextResponse.json(
      {
        error: `This run already has ${existing.people.length} ${peopleWord(existing.people.length)}, so only ${room} more can be added. Remove some people and try again.`,
      },
      { status: 400 },
    );
  }

  // Cheap duplicate rejection BEFORE any capture. The authoritative check runs
  // again under the lock, because the run can change while we capture, but
  // skipping this one meant a doomed request spent seconds of capture first —
  // and on a deployment with an Apify token, real money.
  const alreadyInRun = findDuplicate(entries, existing);
  if (alreadyInRun) {
    return NextResponse.json(
      { error: `${alreadyInRun} is already in this run, so nothing new would be added.` },
      { status: 400 },
    );
  }

  const limit = rateLimit(request, Date.now(), RATE_ACTIONS.extendRun);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many people added to runs from this network in the last minute. Try again in ${limit.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  // Validation, capacity and duplicate checks above are synchronous, so a
  // doomed request is refused before any capture. The slow work runs in the
  // background; the client follows progress over SSE on the same run id.
  const started = startExtendRun(
    runId,
    entries.map((entry) => ({
      linkedin: entry.linkedin,
      instagram: entry.instagram,
      name: entry.name,
      linkedinText: entry.linkedinText,
      instagramText: entry.instagramText,
    })),
    // The pre-check read above counted every stored person: publish the new
    // denominator now so first-paint progress aims at it, not the old total.
    existing.people.length + entries.length,
  );
  if (!started) {
    return NextResponse.json(
      { error: "The server is busy processing other runs. Try again in a few seconds." },
      { status: 429, headers: { "retry-after": "15" } },
    );
  }

  return NextResponse.json({ runId }, { status: 202 });
}

function peopleWord(n: number): string {
  return n === 1 ? "person" : "people";
}

/**
 * Names the first submitted person whose profile is already in the run, or
 * null. Handles are case-insensitive on both platforms, so comparison is
 * lowercased. Used as a cheap pre-capture check; the in-lock re-check is the
 * authoritative one.
 */
function findDuplicate(
  entries: readonly { linkedin: string; instagram: string }[],
  run: Run,
): string | null {
  const known = new Set<string>([
    ...run.people.map((p) => p.linkedinUrl.toLowerCase()),
    ...run.people.map((p) => p.instagramUrl.toLowerCase()),
  ]);
  for (const entry of entries) {
    const li = normaliseLinkedInUrl(entry.linkedin).toLowerCase();
    const ig = normaliseInstagramUrl(entry.instagram).toLowerCase();
    // Report the name the run already holds, so the message names the person
    // the user is trying to add again rather than the new row.
    const clash = run.people.find(
      (p) => p.linkedinUrl.toLowerCase() === li || p.instagramUrl.toLowerCase() === ig,
    );
    if (clash) return clash.displayName ?? entry.linkedin;
    if (known.has(li) || known.has(ig)) return entry.linkedin;
  }
  return null;
}

// Runs are extended with POST only. Answer other methods with JSON next to
// the precedent set by /api/runs, rather than Next's bodyless 405.
function methodNotAllowed() {
  return NextResponse.json({ error: "Use POST to add people to a run." }, { status: 405 });
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
