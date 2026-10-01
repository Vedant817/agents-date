import { notFound } from "next/navigation";
import Link from "next/link";
import { getStore } from "@/store/runs";
import { summarise } from "@/pipeline/run";
import RunClient from "./client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RunPage(props: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ view?: string; person?: string }>;
}) {
  const { runId } = await props.params;
  const store = getStore();
  const run = await store.get(runId);
  if (!run) notFound();

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
            {run.isSample ? "Example run" : "Your run"}
            {summary.ready > 0 ? ` — ${summary.ready} agent${summary.ready === 1 ? "" : "s"} ready` : ""}
          </h1>
          <p className="lede mb0">
            Open a person to read what their agent found, then the dates their agents went on, then who they rank best.
          </p>
        </div>
        <div className="cluster">
          <Link className="btn btn-sm" href="/">
            Add more people
          </Link>
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
        </div>
        <div className="fact">
          <b>{summary.failed}</b>
          <span>unreadable</span>
        </div>
      </div>

      {run.isSample && (
        <div className="notice notice-warn">
          <b>This run used the built-in example personas.</b> The people below are illustrative sample data, not real
          profiles, so nothing here is a capture of an actual person. Add your own two links to see the pipeline run on
          real public profiles.
        </div>
      )}

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
