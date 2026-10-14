"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import RunProgress from "../../run-progress";

/**
 * Shown when the run page loads while the run is still processing.
 * Follows the same event stream as the start page and re-renders the server
 * page the moment the job completes.
 */
export default function RunLive({ runId }: { runId: string }) {
  const router = useRouter();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  return <RunProgress runId={runId} onDone={refresh} />;
}
