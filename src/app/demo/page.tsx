import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
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
          <h2>The demo run has not been generated</h2>
          <p>
            Run <code className="mono">npm run seed</code> to build the 26-person demo run, then reload this page.
          </p>
        </section>
      </main>
    );
  }

  const s = summarise(run);
  const citedTraits = run.people.reduce((n, p) => n + (p.analysis?.traits.length ?? 0), 0);
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
      <h1 style={{ fontSize: 34 }}>26 agents, 19 dates, every shortlist ranked.</h1>
      <p className="lede" style={{ fontSize: 15.5 }}>
        This is a completed run, not a mock-up. Each agent read exactly two profiles, extracted{" "}
        <b style={{ color: "var(--text)" }}>{citedTraits} cited traits</b>, then dated the other agents. Every claim
        below links back to the source line that justified it.
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
          <span>cited traits</span>
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
