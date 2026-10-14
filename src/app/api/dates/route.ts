import { NextResponse } from "next/server";
import { z } from "zod";
import { runDate } from "@/dating/engine";
import { SHOWCASE_RUN_ID } from "@/pipeline/run";
import { getStore } from "@/store/runs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Run } from "@/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  runId: z.string({ required_error: "Pick a run first." }).min(1, "Pick a run first."),
  a: z.string({ required_error: "Pick the first person." }).min(1, "Pick the first person."),
  b: z.string({ required_error: "Pick the second person." }).min(1, "Pick the second person."),
});

/**
 * Dates any two people on demand, without touching the stored run.
 *
 * The planner only schedules each agent's first choice and top-ups, so most
 * pairs never date — but the fun question is always "what if THESE two went
 * out?" This computes their date live from the same deterministic engine and
 * returns it without saving: the run keeps exactly the dates its own plan
 * produced. No external calls happen here, so there is no spend to protect
 * with a rate limit.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Send the pair as JSON." }, { status: 415 });
  }

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
  const { runId, a, b } = parsed.data;
  if (a === b) {
    return NextResponse.json({ error: "Pick two different people — nobody dates themselves." }, { status: 400 });
  }

  let run: Run | null;
  if (runId === SHOWCASE_RUN_ID) {
    try {
      run = JSON.parse(await readFile(path.join(process.cwd(), "data", `${SHOWCASE_RUN_ID}.json`), "utf8")) as Run;
    } catch {
      return NextResponse.json({ error: "The showcase run could not be loaded." }, { status: 500 });
    }
  } else {
    const store = getStore();
    try {
      run = await store.get(runId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "The run could not be read." },
        { status: 500 },
      );
    }
  }
  if (!run) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }

  const byId = new Map(run.people.map((p) => [p.id, p]));
  const personA = byId.get(a);
  const personB = byId.get(b);
  if (!personA || !personB) {
    return NextResponse.json({ error: "One of those people is not in this run." }, { status: 400 });
  }
  if (!personA.analysis || personA.status !== "ready" || !personB.analysis || personB.status !== "ready") {
    return NextResponse.json(
      { error: "Both people need a readable profile before their agents can date." },
      { status: 400 },
    );
  }

  const session = runDate(run.id, personA.analysis, personB.analysis);
  return NextResponse.json({ session }, { status: 200 });
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Use POST to date a pair." }, { status: 405 });
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
