import StartForm from "./start-form";
import { getStore } from "@/store/runs";
import type { Run } from "@/core/types";

/**
 * Server component: the ONLY place that may read server-only env. The form
 * itself is a client component, and client bundles never receive
 * process.env.APIFY_TOKEN (only NEXT_PUBLIC_* is exposed), so reading it
 * there always evaluated to false and the "capture is off" notice was
 * effectively hardcoded. The boolean crosses the boundary as a prop.
 */
export default async function StartPage(props: { searchParams: Promise<{ from?: string }> }) {
  const captureEnabled = Boolean(process.env.APIFY_TOKEN);

  // ?from=<runId> means "add to the run I already have". Reading it here, on
  // the server, means the form is already populated on first paint instead of
  // flickering from empty to full after hydration.
  const params = await props.searchParams;
  const requested = typeof params?.from === "string" ? params.from : null;
  let extendRun: Run | null = null;
  if (requested && !requested.includes("/")) {
    try {
      extendRun = await getStore().get(requested);
    } catch {
      // An unreadable run is reported as nothing to extend rather than a 500:
      // the visitor still gets a working empty form.
      extendRun = null;
    }
  }

  return <StartForm captureEnabled={captureEnabled} extendRun={extendRun} />;
}
