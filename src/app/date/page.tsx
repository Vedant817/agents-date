import { readFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@/store/runs";
import { SHOWCASE_RUN_ID } from "@/pipeline/run";
import type { Run } from "@/core/types";
import DatePlayer from "./player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface DateRunOption {
  id: string;
  label: string;
  people: { id: string; name: string; modes: { linkedin?: string; instagram?: string } }[];
}

async function loadShowcase(): Promise<Run | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", `${SHOWCASE_RUN_ID}.json`), "utf8")) as Run;
  } catch {
    return null;
  }
}

function toOption(run: Run, label: string): DateRunOption {
  return {
    id: run.id,
    label,
    people: run.people
      .filter((p) => p.status === "ready" && p.analysis)
      .map((p) => ({
        id: p.id,
        name: p.displayName ?? p.id,
        modes: {
          linkedin: p.analysis?.sources.linkedin.readMode,
          instagram: p.analysis?.sources.instagram.readMode,
        },
      }))
      .sort((x, y) => x.name.localeCompare(y.name)),
  };
}

/**
 * Instant date: pick any two people from any run and watch their agents date,
 * live. The planner only schedules first choices, so most pairs never meet —
 * this answers "what if THESE two went out?" without touching the stored run.
 */
export default async function DatePage(props: {
  searchParams: Promise<{ run?: string; a?: string; b?: string }>;
}) {
  const store = getStore();
  let runs: Run[] = [];
  try {
    runs = await store.list();
  } catch {
    runs = [];
  }
  const demo = await loadShowcase();

  const options: DateRunOption[] = [
    ...(demo ? [toOption(demo, `Showcase run (${demo.people.length} people)`)] : []),
    ...runs.map((run) =>
      toOption(
        run,
        `${run.people.filter((p) => p.status === "ready").length} agents · ${new Date(run.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      ),
    ),
  ].filter((o) => o.people.length >= 2);

  const params = await props.searchParams;
  const initial =
    params?.run && options.some((o) => o.id === params.run)
      ? { runId: params.run, a: params.a ?? "", b: params.b ?? "" }
      : null;

  return (
    <main>
      <div className="page-head">
        <p className="eyebrow">Instant date</p>
        <h1>
          Pick two people.
          <br />
          Watch their agents date, live.
        </h1>
      </div>
      <p className="lede">
        Any pair from any run — including pairs the planner never scheduled. The date plays turn by turn, computed
        fresh by the same deterministic engine, and nothing is saved: the run keeps exactly the dates it already had.
        Every date is a simulated conversation — neither person said any of it.
      </p>
      {options.length === 0 ? (
        <section className="panel empty">
          <h2>No datable runs yet</h2>
          <p>A date needs a run with at least two readable profiles. Start one below.</p>
        </section>
      ) : (
        <DatePlayer runs={options} initial={initial} />
      )}
    </main>
  );
}
