import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { DEMO_RUN_ID, summarise } from "@/pipeline/run";
import type { Run } from "@/core/types";
import RunClient from "../run/[runId]/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadDemo(): Promise<Run | null> {
  const file = path.join(process.cwd(), "data", `${DEMO_RUN_ID}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as Run;
  } catch {
    return null;
  }
}

export default async function DemoPage() {
  const run = await loadDemo();
  if (!run) {
    return (
      <main>
        <section className="panel empty">
          <h2>The demo run is not available</h2>
          <p>
            The pre-built demo could not be loaded on this deployment. You can still add your own profiles on the start
            page and see the full pipeline run.
          </p>
          <Link href="/" className="btn btn-primary">
            Add your own links
          </Link>
        </section>
      </main>
    );
  }

  const s = summarise(run);
  const citedTraits = run.people.reduce((n, p) => n + (p.analysis?.traits.length ?? 0), 0);
  // How many people have evidence from BOTH sources, rather than claiming it.
  const bothSources = run.people.filter((p) => {
    const ev = (p.analysis?.traits ?? []).flatMap((t) => t.evidence);
    return ev.some((e) => e.source === "linkedin") && ev.some((e) => e.source === "instagram");
  }).length;
  const citedTurns = run.people.reduce(
    (n, p) => n + (p.sessions ?? []).reduce((m, d) => m + d.turns.filter((t) => t.evidence.length > 0).length, 0),
    0,
  );
  const allTurns = run.people.reduce(
    (n, p) => n + (p.sessions ?? []).reduce((m, d) => m + d.turns.length, 0),
    0,
  );

  return (
    <main>
      <h1 style={{ fontSize: 34 }}>
        {s.ready} agents, {s.sessions} dates, every shortlist ranked.
      </h1>
      <p className="lede" style={{ fontSize: 15.5 }}>
        Work through it in order: <b style={{ color: "var(--text)" }}>Profiles</b> shows what each agent found,{" "}
        <b style={{ color: "var(--text)" }}>Dates</b> shows the agents actually dating, and{" "}
        <b style={{ color: "var(--text)" }}>Rankings</b> shows who each person fits best. Every trait links back to the
        source line that justified it, and {Math.round((citedTurns / Math.max(1, allTurns)) * 100)}% of date turns carry
        a citation.
      </p>

      <div className="grid grid-4" style={{ margin: "20px 0 22px" }}>
        <div className="stat">
          <b>{s.ready}</b>
          <span>people profiled</span>
        </div>
        <div className="stat">
          <b>{s.sessions}</b>
          <span>agent dates</span>
        </div>
        <div className="stat">
          <b>{citedTraits}</b>
          <span>cited traits ({bothSources} of {s.ready} cite both sources)</span>
        </div>
        <div className="stat">
          <b>
            {allTurns > 0 ? Math.round((citedTurns / allTurns) * 100) : 0}%
          </b>
          <span>date turns with evidence</span>
        </div>
      </div>

      <div className="notice notice-warn">
        <b>What this demo is:</b> the complete pipeline running on 26 clearly-labelled synthetic personas, so you can
        judge the analysis, the dating and the ranking without a scraping credential. <b>What it is not:</b> real
        people&apos;s profiles. LinkedIn returns HTTP 999 to automated readers and Instagram serves a
        JavaScript-only page, so this repo cannot capture real profiles without an Apify token — the same code path
        reads real ones the moment a token is configured. Add your own links on the start page to see it run on you.
      </div>

      <RunClient run={run} />
    </main>
  );
}
