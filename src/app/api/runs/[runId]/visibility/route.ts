import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/store/runs";
import { verifyToken } from "@/api/manage-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  listed: z.boolean({ required_error: "Say whether the run should be listed.", invalid_type_error: "Listed must be true or false." }),
  manageToken: z.string().min(1, "The manage token is required.").max(200),
});

/**
 * Lists or unlists a run in the public gallery. Runs are unlisted by
 * default; the creator opts in with the manage token returned at creation.
 * Direct links work either way — listing only controls the gallery.
 */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Send the choice as JSON." }, { status: 415 });
  }
  const { runId } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

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
  if (run.manageTokenHash && !verifyToken(parsed.data.manageToken, run.manageTokenHash)) {
    return NextResponse.json(
      { error: "This run is managed. Provide its manage token to change this." },
      { status: 403 },
    );
  }

  const saved = await store.update(runId, (fresh) => ({ ...fresh, listed: parsed.data.listed }));
  if (!saved) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }
  return NextResponse.json({ runId: saved.id, listed: saved.listed ?? false }, { status: 200 });
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Use POST to change listing." }, { status: 405 });
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
