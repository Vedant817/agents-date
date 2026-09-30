import { NextResponse } from "next/server";
import { getStore } from "@/store/runs";
import { summarise } from "@/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const store = getStore();
  const run = await store.get(runId);
  if (!run) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }
  return NextResponse.json({ run, summary: summarise(run) });
}
