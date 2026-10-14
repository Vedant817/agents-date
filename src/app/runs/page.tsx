import Link from "next/link";
import { existsSync } from "node:fs";
import path from "node:path";
import { getStore } from "@/store/runs";
import { SHOWCASE_RUN_ID, summarise } from "@/pipeline/run";
import type { Run } from "@/core/types";
import CopyRunLink from "./copy-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every run on this server that its creator chose to list — plus the pinned
 * showcase. Runs are UNLISTED by default: a direct link always opens, but
 * only opt-in runs appear here. That is what makes the footer ("do not
 * share without permission") coherent instead of decorative.
 */
export default async function RunsPage() {
  const store = getStore();
  let runs: Run[] = [];
  try {
    // Newest 200 parsed at most: listed runs live near the head, and the
    // gallery shows 30. Parsing the whole store per hit took 17s locally.
    runs = (await store.list(200)).filter((run) => run.listed === true);
  } catch {
    runs = [];
  }
  const summaries = runs.map((run) => ({ run, summary: summarise(run) }));
  // The pinned showcase card promises a finished run: only render it when
  // the file exists, instead of advertising an empty state as content.
  const showcaseAvailable = existsSync(path.join(process.cwd(), "data", `${SHOWCASE_RUN_ID}.json`));
  // The gallery is a directory, not an archive: runs pile up on a long-lived
  // server, and rendering all of them buries the ones a visitor wants.
  // Latest 30, newest first.
  const GALLERY_LIMIT = 30;
  const visible = summaries.slice(0, GALLERY_LIMIT);
  const hidden = summaries.length - visible.length;

  return (
    <main>
      <div className="page-head">
        <p className="eyebrow">Runs on this server</p>
        <h1>
          {summaries.length > 0 ? `${summaries.length} run${summaries.length === 1 ? "" : "s"} creators chose to
          share` : "No shared runs yet"} — and the showcase that never expires.
        </h1>
      </div>
      <p className="lede">
        These are the runs their creators chose to list. Every run also has its own link, shared privately by its
        creator — unlisted runs open fine, they just never appear here.
      </p>

      <div className="grid grid-2 mt16">
        {showcaseAvailable && (
          <section className="panel person-card">
            <div className="person-top">
              <div>
                <div className="person-name">Showcase run</div>
                <div className="person-sub">real volunteers · always available</div>
              </div>
              <span className="chip">pinned</span>
            </div>
            <p className="small dim">
              The finished example: analysed profiles, recorded agent dates, every shortlist ranked.
            </p>
            <Link className="btn btn-sm" href={`/demo`}>
              Open the showcase
            </Link>
          </section>
        )}

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
                  {/* Creators opted these runs into the gallery, so naming
                      names is consented visibility — and a wall of identical
                      "N agents" cards is unscannable without them. */}
                  {run.people
                    .filter((p) => p.status === "ready")
                    .slice(0, 3)
                    .map((p) => p.displayName ?? p.id)
                    .join(" · ")}
                  {summary.ready > 3 ? ` · +${summary.ready - 3} more` : ""}
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
                {run.status === "complete"
                  ? `${summary.sessions} date${summary.sessions === 1 ? "" : "s"}`
                  : run.status}
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
          <h2>No shared runs yet</h2>
          <p>
            Runs stay unlisted unless their creator shares them. Start one of your own — it stays private to its link
            unless you list it.
          </p>
          <Link className="btn btn-primary" href="/">
            Add profiles
          </Link>
        </section>
      )}

      {store.isEphemeral() && summaries.length > 0 && (
        <div className="notice notice-info">
          These runs live on temporary disk and can disappear when the server restarts. The{" "}
          <Link href="/demo">showcase run</Link> does not expire.
        </div>
      )}
    </main>
  );
}
