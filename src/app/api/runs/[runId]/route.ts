import { NextResponse } from "next/server";
import { getStore } from "@/store/runs";
import { summarise } from "@/pipeline/run";

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
  return NextResponse.json({ run, summary: summarise(run) });
}
