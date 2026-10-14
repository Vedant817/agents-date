import { NextResponse } from "next/server";
import { getStore } from "@/store/runs";
import { verifyToken } from "@/api/manage-token";
import { summarise } from "@/pipeline/run";
import type { Run } from "@/core/types";

/** The hash is access-control metadata, not run content: never serve it. */
function publicRun(run: Run): Omit<Run, "manageTokenHash"> {
  const rest = { ...run };
  delete rest.manageTokenHash;
  return rest;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const store = getStore();
  let run;
  try {
    run = await store.get(runId);
  } catch (error) {
    // A corrupt or unreadable run is a server-side problem, not a 404. Saying
    // "does not exist or has expired" here hides real data loss.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run could not be read." },
      { status: 500 },
    );
  }
  if (!run) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }
  return NextResponse.json({ run: publicRun(run), summary: summarise(run) });
}
/**
 * Deletes a run: the takedown path. Requires the manage token when the run
 * carries a hash, so only the creator (or anyone they gave the token) can
 * remove it. The token travels in the JSON body: { manageToken }.
 */
export async function DELETE(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const store = getStore();
  let run;
  try {
    run = await store.get(runId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run could not be read." },
      { status: 500 },
    );
  }
  if (!run) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }
  if (run.manageTokenHash) {
    let token: string | null = null;
    try {
      const body = (await request.json()) as { manageToken?: unknown };
      token = typeof body?.manageToken === "string" ? body.manageToken : null;
    } catch {
      token = null;
    }
    if (!token || !verifyToken(token, run.manageTokenHash)) {
      return NextResponse.json(
        { error: "This run is managed. Provide its manage token to delete it." },
        { status: 403 },
      );
    }
  }
  await store.delete(runId);
  return NextResponse.json({ deleted: true }, { status: 200 });
}

// Reads use GET, deletion uses DELETE. Anything else gets JSON rather than
// Next's bodyless 405, matching every other route in this API.
function methodNotAllowed() {
  return NextResponse.json({ error: "Use GET to read a run, DELETE to remove it." }, { status: 405 });
}

export async function POST() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}
