import Link from "next/link";
import { getStore } from "@/store/runs";
import { summarise } from "@/pipeline/run";
import type { Run } from "@/core/types";
import CopyRunLink from "./copy-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every run on this server, newest first. Runs are shareable by link, so
 * this is also the directory people pass around: each card links straight
 * to the finished run.
 */
export default async function RunsPage() {
  const store = getStore();
  let runs: Run[] = [];
  try {
    runs = await store.list();
  } catch {
    runs = [];
  }
  const summaries = runs.map((run) => ({ run, summary: summarise(run) }));
  // The gallery is a directory, not an archive: test and verification runs
  // pile up on a long-lived server (hundreds), and rendering all of them
  // buries the runs a visitor actually wants. Latest 30, newest first.
  const GALLERY_LIMIT = 30;
  const visible = summaries.slice(0, GALLERY_LIMIT);
  const hidden = summaries.length - visible.length;

  return (
    <main>
      <div className="page-head">
        <p className="eyebrow">Runs on this server</p>
        <h1>
          {summaries.length > 0 ? `${summaries.length} run${summaries.length === 1 ? "" : "s"}` : "No runs yet"} — and
          the demo that never expires.
        </h1>
      </div>
      <p className="lede">
        Every run has its own link. Open one to read the profiles, watch the dates, and see each shortlist ranked.
      </p>

      <div className="grid grid-2 mt16">
        <section className="panel person-card">
          <div className="person-top">
            <div>
              <div className="person-name">Live demo</div>
              <div className="person-sub">26 agents · 18 dates · always available</div>
            </div>
            <span className="chip">pinned</span>
          </div>
          <p className="small dim">
            The finished example: analysed profiles, recorded agent dates, every shortlist ranked.
          </p>
          <Link className="btn btn-sm" href={`/demo`}>
            Open the demo
          </Link>
        </section>

        {visible.map(({ run, summary }) => (
          <section className="panel person-card" key={run.id}>
            <div className="person-top">
              <div>
                <div className="person-name">
                  {summary.ready > 0
                    ? `${summary.ready} agent${summary.ready === 1 ? "" : "s"}`
                    : "Unreadable run"}
                </div>
                <div className="person-sub">
                  {summary.sessions} date{summary.sessions === 1 ? "" : "s"} ·{" "}
                  {new Date(run.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {run.status === "running" ? " · still processing" : ""}
                  {summary.failed > 0 ? ` · ${summary.failed} unreadable` : ""}
                </div>
              </div>
              <span className={run.status === "complete" ? "score-pill" : "chip"}>
                {run.status === "complete" ? `${summary.sessions} dates` : run.status}
              </span>
            </div>
            <div className="cluster mt16">
              <Link className="btn btn-sm" href={`/run/${run.id}`}>
                Open run
              </Link>
              <CopyRunLink runId={run.id} />
            </div>
          </section>
        ))}
      </div>

      {hidden > 0 && (
        <p className="small dim mt16 mb0">
          Showing the latest {visible.length} of {summaries.length} runs. Older runs still open by their own links.
        </p>
      )}

      {summaries.length === 0 && (
        <section className="panel empty">
          <h2>No runs on this server yet</h2>
          <p>Yours will appear here the moment you start one — each with a link you can share.</p>
          <Link className="btn btn-primary" href="/">
            Add profiles
          </Link>
        </section>
      )}

      {store.isEphemeral() && summaries.length > 0 && (
        <div className="notice notice-info">
          These runs live on temporary disk and can disappear when the server restarts. The{" "}
          <Link href="/demo">demo run</Link> does not expire.
        </div>
      )}
    </main>
  );
}
