import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { SHOWCASE_RUN_ID, summarise } from "@/pipeline/run";
import type { Run } from "@/core/types";
import RunClient from "../run/[runId]/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The showcase: a REAL run built from consenting volunteers' pasted
 * profiles, committed at data/showcase.json. There is no synthetic data in
 * this product — no seed script, no invented personas. Until volunteers
 * contribute, this page renders its empty state instead of faking one.
 */
async function loadShowcase(): Promise<Run | null> {
  const file = path.join(process.cwd(), "data", `${SHOWCASE_RUN_ID}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as Run;
  } catch {
    return null;
  }
}

export default async function DemoPage(props: {
  searchParams: Promise<{ view?: string; person?: string }>;
}) {
  const run = await loadShowcase();
  if (!run) {
    return (
      <main>
        <div className="page-head">
          <p className="eyebrow">Showcase run</p>
          <h1>No showcase run yet</h1>
        </div>
        <section className="panel empty">
          <p>
            The showcase is a real run built from consenting volunteers — never synthetic data, so there is nothing to
            show until people contribute their own profiles. Start a run of your own, or volunteer yours for the
            showcase.
          </p>
          <Link href="/" className="btn btn-primary">
            Add profiles
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

  // Deep links are resolved on the server so the first paint matches the link.
  const params = await props.searchParams;
  const initialView = params?.view === "dates" || params?.view === "rankings" || params?.view === "profiles"
    ? params.view
    : "profiles";
  const knownPeople = new Set(run.people.filter((p) => p.status === "ready").map((p) => p.id));
  const initialPerson = params?.person && knownPeople.has(params.person) ? params.person : null;

  return (
    <main>
      <div className="page-head">
        <p className="eyebrow">Showcase run · real consenting volunteers</p>
        <h1>
          {s.ready} agents, {s.sessions} dates, every shortlist ranked.
        </h1>
      </div>
      <p className="lede">
        Work through it in order: <b>Profiles</b> shows what each agent found, <b>Dates</b> shows the agents actually
        dating, and <b>Rankings</b> shows who each person fits best. Every trait links back to the source line that
        justified it, and {Math.round((citedTurns / Math.max(1, allTurns)) * 100)}% of date turns carry a citation.
      </p>

      <p className="small dim">
        <b>Why {s.sessions} dates and not {s.ready}:</b> each agent dates the person it ranks first, and two agents who
        choose each other share one date, so {s.ready} first choices collapse into {s.sessions} distinct pairs. Every agent
        appears in at least one date.
      </p>
      <div className="facts">
        <div className="fact">
          <b>{s.ready}</b>
          <span>people profiled</span>
        </div>
        <div className="fact">
          <b>{s.sessions}</b>
          <span>agent dates</span>
          {/* State the rule, not just the number: N first choices collapse
              into M distinct pairs, because mutual choices share a date. */}
          <span className="fact-sub">{s.ready} first choices, {s.sessions} pairs</span>
        </div>
        <div className="fact">
          <b>{citedTraits}</b>
          <span>cited traits</span>
          <span className="fact-sub">
            {bothSources} of {s.ready} cite both sources
          </span>
        </div>
        <div className="fact">
          <b>{allTurns > 0 ? Math.round((citedTurns / allTurns) * 100) : 0}%</b>
          <span>date turns with evidence</span>
        </div>
      </div>

      <div className="notice notice-info">
        <b>What this showcase is:</b> the complete pipeline running on real people who consented to be here — every
        profile below was pasted by its owner, and every quote links back to text they provided. <b>What it is not:</b>{" "}
        scraped data or invented personas. LinkedIn returns HTTP 999 to automated readers and Instagram serves a
        JavaScript-only page, so link-only reading needs an Apify token; until then, consent means pasting your own
        visible profile text. Add your own links on the start page to see it run on you.
      </div>

      <RunClient run={run} initialView={initialView} initialPerson={initialPerson} />
    </main>
  );
}
