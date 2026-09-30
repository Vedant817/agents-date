import { notFound } from "next/navigation";
import Link from "next/link";
import { getStore } from "@/store/runs";
import { summarise } from "@/pipeline/run";
import RunClient from "./client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RunPage(props: { params: Promise<{ runId: string }> }) {
  const { runId } = await props.params;
  const store = getStore();
  const run = await store.get(runId);
  if (!run) notFound();

  const summary = summarise(run);

  return (
    <main>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 32 }}>
            {run.isDemo ? "Demo run" : "Your run"}
            {summary.ready > 0 ? ` — ${summary.ready} agent${summary.ready === 1 ? "" : "s"} ready` : ""}
          </h1>
          <p className="lede" style={{ fontSize: 15 }}>
            Open a person to read what their agent found, then the dates their agents went on, then who they rank best.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn-sm btn-ghost" href="/">
            Add more people
          </Link>
        </div>
      </div>

      <div className="grid grid-4" style={{ margin: "18px 0 22px" }}>
        <div className="stat">
          <b>{summary.total}</b>
          <span>people</span>
        </div>
        <div className="stat">
          <b>{summary.ready}</b>
          <span>profiles read</span>
        </div>
        <div className="stat">
          <b>{summary.sessions}</b>
          <span>dates completed</span>
        </div>
        <div className="stat">
          <b>{summary.failed}</b>
          <span>unreadable</span>
        </div>
      </div>

      {run.notes && run.notes.length > 0 && (
        <div className="notice notice-warn">
          {run.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
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
        <RunClient run={run} />
      )}
    </main>
  );
}
