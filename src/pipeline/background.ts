import { ConsentedTextAdapter } from "@/ingest/public";
import { buildAdapters, normaliseInstagramUrl, normaliseLinkedInUrl } from "@/ingest/setup";
import type { PersonRecord } from "@/core/types";
import { computeNetwork, processPerson, reassignPersonId } from "@/pipeline/run";
import { getStore } from "@/store/runs";

/**
 * Background run processing with live progress.
 *
 * Creating or extending a run is slow (capture per person, then dating and
 * ranking), and the request used to block until all of it finished — a 20
 * person run holds the connection open for the whole capture. Now the route
 * returns 202 immediately and this module does the work, emitting progress
 * events that the SSE endpoint streams to the browser.
 *
 * Runs on a single Node instance (Render free plan, `next start`). There is
 * no cross-instance bus: with one instance the in-memory map is the bus. If
 * the process restarts mid-run the run stays `running` and the run page says
 * so, rather than pretending it finished.
 */

export type ProgressType =
  | "snapshot"
  | "person-started"
  | "person-done"
  | "dates"
  | "complete"
  | "failed";

export interface ProgressEvent {
  readonly seq: number;
  readonly type: ProgressType;
  /** How many people this job will process in total. */
  readonly total: number;
  readonly personId?: string;
  readonly displayName?: string;
  /** People finished so far (only on snapshot/person-done). */
  readonly done?: number;
  readonly ready?: number;
  readonly sessions?: number;
  readonly error?: string;
}

type Listener = (evt: ProgressEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const seqs = new Map<string, number>();
const totals = new Map<string, number>();

/** Test hook: in-flight jobs by run id, so tests can await completion. */
const pendingJobs = new Map<string, Set<Promise<void>>>();

function trackJob(runId: string, job: Promise<void>): void {
  let set = pendingJobs.get(runId);
  if (!set) {
    set = new Set();
    pendingJobs.set(runId, set);
  }
  set.add(job);
  void job.catch(() => undefined).finally(() => {
    set.delete(job);
    if (set.size === 0) {
      pendingJobs.delete(runId);
      // seqs/totals are only meaningful while a job is in flight. Prune with
      // the set so a long-lived process does not accumulate one entry per
      // run id forever.
      seqs.delete(runId);
      totals.delete(runId);
    }
  });
}

function nextSeq(runId: string): number {
  const n = (seqs.get(runId) ?? 0) + 1;
  seqs.set(runId, n);
  return n;
}

export function subscribe(runId: string, listener: Listener): () => void {
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(runId);
  };
}

function emit(runId: string, evt: Omit<ProgressEvent, "seq" | "total"> & { total?: number }): void {
  const full: ProgressEvent = {
    ...evt,
    seq: nextSeq(runId),
    total: evt.total ?? totals.get(runId) ?? 0,
  };
  listeners.get(runId)?.forEach((fn) => {
    try {
      fn(full);
    } catch {
      // A broken subscriber must not break processing for everyone else.
    }
  });
}

/** Replays the current state for a late subscriber, then live events follow. */
export async function snapshot(runId: string): Promise<ProgressEvent> {
  const store = getStore();
  const run = await store.get(runId).catch(() => null);
  if (!run) {
    return { seq: nextSeq(runId), type: "failed", total: 0, error: "That run does not exist or has expired." };
  }
  const ready = run.people.filter((p) => p.status === "ready").length;
  const active = isRunActive(runId);
  // A new job on an already-complete run (extending it) must NOT replay the
  // old completion as if the new work were done: the stream closed instantly
  // and the client moved on before the merge landed. While a job is active
  // the snapshot is always live, whatever the stored status says.
  if (run.status === "complete" && !active) {
    let sessions = 0;
    const seen = new Set<string>();
    for (const p of run.people) {
      for (const s of p.sessions ?? []) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          sessions += 1;
        }
      }
    }
    return { seq: nextSeq(runId), type: "complete", total: totals.get(runId) ?? run.people.length, done: run.people.length, ready, sessions };
  }
  if (run.status === "failed" && !isRunActive(runId)) {
    return { seq: nextSeq(runId), type: "failed", total: totals.get(runId) ?? run.people.length, done: run.people.length, ready, error: "No profile could be read." };
  }
  return {
    seq: nextSeq(runId),
    type: "snapshot",
    total: totals.get(runId) ?? run.people.length,
    done: run.people.length,
    ready,
  };
}

export interface JobEntry {
  readonly linkedin: string;
  readonly instagram: string;
  readonly name?: string;
  readonly linkedinText?: string;
  readonly instagramText?: string;
}

function buildJobAdapters(entries: readonly JobEntry[]) {
  const adapters = buildAdapters();
  const supplied = adapters.find((a): a is ConsentedTextAdapter => a instanceof ConsentedTextAdapter);
  for (const entry of entries) {
    if (!supplied) break;
    if (entry.linkedinText?.trim()) supplied.supply("linkedin", normaliseLinkedInUrl(entry.linkedin), entry.linkedinText);
    if (entry.instagramText?.trim()) supplied.supply("instagram", normaliseInstagramUrl(entry.instagram), entry.instagramText);
  }
  return adapters;
}

/** Awaits every background job for a run. Resolves when they settle; rejects never. */
export function waitForRun(runId: string, timeoutMs = 120_000): Promise<void> {
  const jobs = [...(pendingJobs.get(runId) ?? [])];
  if (jobs.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.allSettled(jobs).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** True while a job is still working on this run. The run page uses it to tell
 * a live run apart from one orphaned by a restart. */
export function isRunActive(runId: string): boolean {
  return (pendingJobs.get(runId)?.size ?? 0) > 0;
}

/**
 * Processes a brand-new run in the background. Saves each finished person as
 * it goes, so a refresh mid-run shows real progress instead of an empty page.
 */
export function startCreateRun(runId: string, entries: JobEntry[]): void {
  totals.set(runId, entries.length);
  const job = (async () => {
    const store = getStore();
    try {
      const adapters = buildJobAdapters(entries);
      const people: PersonRecord[] = [];
      for (const [i, entry] of entries.entries()) {
        const personId = `p${i + 1}`;
        emit(runId, { type: "person-started", personId });
        const person = await processPerson(
          runId,
          { linkedin: entry.linkedin, instagram: entry.instagram, name: entry.name },
          adapters,
          personId,
        );
        people.push(person);
        // Incremental save: the run page polls the same store, so progress is
        // visible even without the event stream.
        await store.update(runId, (fresh) => ({ ...fresh, people: [...fresh.people, person] }));
        emit(runId, {
          type: "person-done",
          personId,
          displayName: person.displayName,
          done: people.length,
          ready: people.filter((p) => p.status === "ready").length,
        });
      }
      const computed = computeNetwork(people);
      let sessions = 0;
      {
        const seen = new Set<string>();
        for (const p of computed) {
          for (const s of p.sessions ?? []) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              sessions += 1;
            }
          }
        }
      }
      emit(runId, { type: "dates", sessions });
      const ready = computed.filter((p) => p.status === "ready").length;
      const final = await store.update(runId, (fresh) => ({
        ...fresh,
        people: computed,
        status: ready > 0 ? "complete" : "failed",
      }));
      if (!final) {
        // The run was deleted while we worked. Say so instead of claiming
        // a completion nobody can open.
        emit(runId, { type: "failed", error: "That run does not exist or has expired." });
        return;
      }
      emit(runId, { type: "complete", done: computed.length, ready, sessions });
    } catch (error) {
      await store
        .update(runId, (fresh) => ({ ...fresh, status: "failed" }))
        .catch(() => null);
      emit(runId, {
        type: "failed",
        error: error instanceof Error ? error.message : "Processing failed.",
      });
    }
  })();
  trackJob(runId, job);
}

/**
 * Processes added people in the background and merges them under the run's
 * lock, with the same duplicate and capacity re-checks the synchronous path
 * had. Person ids continue the run's numbering from the authoritative count.
 *
 * `expectedTotal` (existing people + new entries, known by the caller from
 * its pre-check read) is published synchronously so a snapshot taken a
 * millisecond after accept already aims at the new denominator. Without it
 * the total only appears at merge time and early progress reads against the
 * old count — the same stale-denominator race the create path never has.
 */
export function startExtendRun(runId: string, entries: JobEntry[], expectedTotal?: number): void {
  if (expectedTotal !== undefined) totals.set(runId, expectedTotal);
  const job = (async () => {
    const store = getStore();
    try {
      // Publish the expected total up front, so a snapshot taken while this
      // job captures (on an already-complete run) shows live progress toward
      // the new total instead of the previous job's numbers.
      const base = await store.get(runId).catch(() => null);
      totals.set(runId, (base?.people.length ?? 0) + entries.length);
      const adapters = buildJobAdapters(entries);
      const added: PersonRecord[] = [];
      for (const [i, entry] of entries.entries()) {
        emit(runId, { type: "person-started", personId: `new-${i + 1}`, total: entries.length });
        const person = await processPerson(
          runId,
          { linkedin: entry.linkedin, instagram: entry.instagram, name: entry.name },
          adapters,
          `tmp_${i + 1}`,
        );
        added.push(person);
        emit(runId, {
          type: "person-done",
          personId: `new-${i + 1}`,
          displayName: person.displayName,
          total: entries.length,
          done: added.length,
        });
      }

      let conflict: string | null = null;
      const result = await store.update(runId, (fresh) => {
        totals.set(runId, fresh.people.length + added.length);
        if (fresh.people.length + added.length > 20) {
          conflict = `This run already has ${fresh.people.length} people, so these no longer fit. Try again.`;
          return null;
        }
        const known = new Set<string>([
          ...fresh.people.map((p) => p.linkedinUrl.toLowerCase()),
          ...fresh.people.map((p) => p.instagramUrl.toLowerCase()),
        ]);
        for (const person of added) {
          if (known.has(person.linkedinUrl.toLowerCase()) || known.has(person.instagramUrl.toLowerCase())) {
            conflict = `${person.displayName ?? "One of these people"} is already in this run, so nothing new would be added.`;
            return null;
          }
        }
        const firstIndex = fresh.people.length + 1;
        // Deep renumber BEFORE computeNetwork plans anything: analysis and
        // every evidence personId move off the placeholder, or dates cite a
        // phantom and the audit fails on unresolvable quotes.
        const numbered = added.map((person, i) => reassignPersonId(person, `p${firstIndex + i}`));
        const recomputed = computeNetwork([...fresh.people, ...numbered]);
        const notes = new Set([...(fresh.notes ?? [])]);
        const ready = numbered.filter((p) => p.status === "ready").length;
        if (numbered.length > 0) {
          notes.add(
            `Extended with ${ready} more ${ready === 1 ? "person" : "people"}${
              numbered.length - ready > 0 ? ` (${numbered.length - ready} could not be read)` : ""
            }.`,
          );
        }
        if (!process.env.APIFY_TOKEN) {
          notes.add(
            "APIFY_TOKEN is not configured, so only pasted profile text could be read. Add the token to capture public profiles automatically.",
          );
        }
        return {
          ...fresh,
          people: recomputed,
          notes: [...notes],
          status: recomputed.some((p) => p.status === "ready") ? "complete" : fresh.status,
        };
      });

      if (conflict || !result) {
        emit(runId, { type: "failed", error: conflict ?? "That run does not exist or has expired." });
        return;
      }
      const ready = result.people.filter((p) => p.status === "ready").length;
      let sessions = 0;
      {
        const seen = new Set<string>();
        for (const p of result.people) {
          for (const s of p.sessions ?? []) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              sessions += 1;
            }
          }
        }
      }
      emit(runId, { type: "dates", sessions });
      emit(runId, { type: "complete", done: result.people.length, ready, sessions });
    } catch (error) {
      emit(runId, {
        type: "failed",
        error: error instanceof Error ? error.message : "Processing failed.",
      });
    }
  })();
  trackJob(runId, job);
}
