import { NextResponse } from "next/server";
import { getStore } from "@/store/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Liveness + load shedding signal. Reports uptime, background jobs in
 * flight, and stored runs. Monitoring watches this; the admission gate
 * (JOB_CONCURRENCY) is what keeps the numbers small.
 */
export async function GET() {
  const { pendingJobsSnapshot } = await import("@/pipeline/background");
  const store = getStore();
  let runs = -1;
  try {
    runs = await store.count();
  } catch {
    runs = -1;
  }
  return NextResponse.json(
    {
      ok: true,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      jobsInFlight: pendingJobsSnapshot(),
      storedRuns: runs,
      ephemeral: store.isEphemeral(),
    },
    { status: 200 },
  );
}
