import StartForm from "./start-form";

/**
 * Server component: the ONLY place that may read server-only env. The form
 * itself is a client component, and client bundles never receive
 * process.env.APIFY_TOKEN (only NEXT_PUBLIC_* is exposed), so reading it
 * there always evaluated to false and the "capture is off" notice was
 * effectively hardcoded. The boolean crosses the boundary as a prop.
 */
export default function StartPage() {
  const captureEnabled = Boolean(process.env.APIFY_TOKEN);
  return <StartForm captureEnabled={captureEnabled} />;
}
