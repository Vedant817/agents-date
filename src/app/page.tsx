import StartForm from "./start-form";
import HeroDate from "./hero-date";
import { getStore } from "@/store/runs";
import { SHOWCASE_RUN_ID } from "@/pipeline/run";
import type { DateSession, Run } from "@/core/types";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

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

  return (
    <main>
      <HeroSlot />
      <StartForm
        captureEnabled={captureEnabled}
        extendRun={extendRun}
        showcaseAvailable={existsSync(path.join(process.cwd(), "data", `${SHOWCASE_RUN_ID}.json`))}
      />
    </main>
  );
}

/**
 * The ten-second hook lives here, on the server: the showcase's best date
 * plays itself above the form, so a stranger sees value before any labor.
 * No showcase file, no hero — the form stands alone rather than faking one.
 */
async function HeroSlot() {
  let run: Run | null = null;
  try {
    run = JSON.parse(
      await readFile(path.join(process.cwd(), "data", `${SHOWCASE_RUN_ID}.json`), "utf8"),
    ) as Run;
  } catch {
    return null;
  }
  const seen = new Map<string, DateSession>();
  for (const p of run.people) {
    for (const s of p.sessions ?? []) {
      if (!seen.has(s.id)) seen.set(s.id, s);
    }
  }
  let best: DateSession | null = null;
  for (const s of seen.values()) {
    if (!best || (s.evaluation?.overall ?? 0) > (best.evaluation?.overall ?? 0)) best = s;
  }
  if (!best) return null;
  const names = new Map(run.people.map((p) => [p.id, p.displayName ?? p.id]));
  const aName = names.get(best.personAId) ?? "this person";
  const bName = names.get(best.personBId) ?? "this person";
  return (
    <HeroDate
      session={best}
      aName={aName}
      bName={bName}
      dateUrl={`/date?run=${run.id}&a=${best.personAId}&b=${best.personBId}`}
    />
  );
}
