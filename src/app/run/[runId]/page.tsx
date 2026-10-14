import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getStore } from "@/store/runs";
import { DEMO_RUN_ID, summarise } from "@/pipeline/run";
import RunClient from "./client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RunPage(props: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ view?: string; person?: string }>;
}) {
  const { runId } = await props.params;
  const store = getStore();
  let run;
  try {
    run = await store.get(runId);
  } catch (error) {
    // A corrupt or unreadable run must not crash through to Next's raw 500
    // page, which drops the visitor outside the site. Say what happened and
    // keep the frame, exactly as the API route already does.
    return (
      <main>
        <div className="page-head">
          <p className="eyebrow">Run could not be read</p>
          <h1>This run exists, but its data is unreadable on this server.</h1>
        </div>
        <p className="lede">
          The stored run file is corrupt or incomplete, so it cannot be shown. Nothing was ranked against anyone else as
          a result.
        </p>
        <div className="notice notice-error">
          <b>Server detail:</b> {error instanceof Error ? error.message : "unknown error"}
        </div>
        <div className="cluster">
          <Link className="btn btn-primary" href="/">
            Add profiles
          </Link>
          <Link className="btn" href="/demo">
            Open the live demo
          </Link>
        </div>
      </main>
    );
  }
  if (!run) {
    // /run/demo is the obvious thing to type, but the demo lives at /demo and
    // is not in the store. Sending that visitor to the generic "expired" page
    // told them their data was lost when it was not.
    if (runId === DEMO_RUN_ID) {
      redirect("/demo");
    }
    notFound();
  }

  const summary = summarise(run);
  // Read the deep link on the server. Doing it in the client only meant the
  // first paint, share previews and crawlers showed the default tab and the
  // first person, so a shared ?view=rankings&person=p20 link looked like it
  // pointed at somebody else.
  const params = await props.searchParams;
  const initialView = params?.view === "dates" || params?.view === "rankings" || params?.view === "profiles"
    ? params.view
    : "profiles";
  const knownPeople = new Set(run.people.filter((p) => p.status === "ready").map((p) => p.id));
  const initialPerson = params?.person && knownPeople.has(params.person) ? params.person : null;

  return (
    <main>
      <div className="cluster cluster-between">
        <div className="page-head">
          <p className="eyebrow">{run.isDemo ? "Completed demo run" : "Your run"}</p>
          <h1>
            Your run
            {summary.ready > 0 ? ` — ${summary.ready} agent${summary.ready === 1 ? "" : "s"} ready` : ""}
          </h1>
          <p className="lede mb0">
            Open a person to read what their agent found, then the dates their agents went on, then who they rank best.
          </p>
        </div>
        <div className="cluster">
          {/* This linked to / which started a fresh run, so the button threw
              away every profile, date and ranking already captured. It now
              resumes the same run, and the start form restores its people. */}
          {run.isDemo ? (
            <Link className="btn btn-sm" href="/">
              Start your own run
            </Link>
          ) : (
            <Link className="btn btn-sm" href={`/?from=${run.id}`}>
              Add more people to this run
            </Link>
          )}
        </div>
      </div>

      <div className="facts">
        <div className="fact">
          <b>{summary.total}</b>
          <span>people</span>
        </div>
        <div className="fact">
          <b>{summary.ready}</b>
          <span>profiles read</span>
        </div>
        <div className="fact">
          <b>{summary.sessions}</b>
          <span>dates completed</span>
          {/* The count was a bare number with no stated rule, so a reader
              could not tell whether it was arbitrary, capped, or a bug.
              It is derived: every agent's first-choice partner, with mutual
              choices sharing one date. */}
          <span className="fact-sub">
            {summary.ready < 2
              ? "a date needs two readable profiles"
              : summary.sessions >= Math.ceil(summary.ready / 2)
                ? `${summary.ready} first choices, ${summary.sessions} distinct pairs`
                : "every agent's first-choice partner"}
          </span>
        </div>
        <div className="fact">
          <b>{summary.failed}</b>
          <span>unreadable</span>
        </div>
      </div>

      <p className="small dim">
        <b>How dates are chosen:</b> each agent dates the person it ranks first, and two agents who choose each other
        share one date, so the pair count is never the same as the agent count. The strongest remaining matches are then
        added until the run reaches 14 dates. Coverage comes first, so a run with many agents can have more dates than
        that target.
      </p>

      {run.notes && run.notes.length > 0 && (
        <div className="notice notice-warn">
          {run.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}

      {!run.isDemo && store.isEphemeral() && (
        <div className="notice notice-info">
          This run is stored on temporary disk, so it may disappear if the server restarts. The{" "}
          <Link href="/demo">
            demo run
          </Link>{" "}
          is always available.
        </div>
      )}

      {summary.ready === 0 ? (
        <section className="panel empty">
          <h2>No profile could be read</h2>
          <p>
            Both platforms block anonymous automated reads, and no profile text was pasted for this run. Add the visible
            profile text on the start page, or configure an Apify token.
          </p>
          <Link className="btn btn-primary" href="/">
            Back to start
          </Link>
        </section>
      ) : (
        <RunClient run={run} initialView={initialView} initialPerson={initialPerson} />
      )}
    </main>
  );
}
