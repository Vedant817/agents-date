"use client";

import { useEffect, useRef, useState } from "react";

interface ProgressState {
  total: number;
  done: number;
  ready: number;
  sessions: number;
  current?: string;
  finished: boolean;
  failed: boolean;
  error?: string;
}

interface WireEvent {
  type: string;
  total?: number;
  personId?: string;
  displayName?: string;
  done?: number;
  ready?: number;
  sessions?: number;
  error?: string;
}

/**
 * Watches a background run over SSE and renders a live checklist.
 *
 * Used in two places: the start page after submit (202 accepted, work in
 * progress) and the run page when it loads a run that is still `running`
 * (refresh mid-run, or a second tab). Calls `onDone` once, on completion.
 */
export default function RunProgress({ runId, onDone }: { runId: string; onDone: (runId: string) => void }) {
  const [state, setState] = useState<ProgressState>({
    total: 0,
    done: 0,
    ready: 0,
    sessions: 0,
    finished: false,
    failed: false,
  });
  const [elapsed, setElapsed] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);

    const apply = (evt: WireEvent) => {
      if (evt.type === "snapshot" || evt.type === "person-started" || evt.type === "person-done") {
        setState((prev) => ({
          ...prev,
          total: evt.total ?? prev.total,
          done: evt.done ?? prev.done,
          ready: evt.ready ?? prev.ready,
          current: evt.type === "person-started" ? evt.personId : prev.current,
        }));
      } else if (evt.type === "dates") {
        setState((prev) => ({ ...prev, sessions: evt.sessions ?? prev.sessions, current: undefined }));
      } else if (evt.type === "complete") {
        setState((prev) => ({
          ...prev,
          total: evt.total ?? prev.total,
          done: evt.done ?? prev.done,
          ready: evt.ready ?? prev.ready,
          sessions: evt.sessions ?? prev.sessions,
          current: undefined,
          finished: true,
        }));
        source.close();
        if (!doneRef.current) {
          doneRef.current = true;
          onDone(runId);
        }
      } else if (evt.type === "failed") {
        setState((prev) => ({ ...prev, failed: true, error: evt.error }));
        source.close();
      }
    };

    const handler = (e: MessageEvent) => {
      try {
        apply(JSON.parse(e.data) as WireEvent);
      } catch {
        // A malformed event must not kill the stream; the next one follows.
      }
    };
    // The server sends named events (snapshot, person-done, complete, ...).
    // Named events do not reach onmessage, so listen per type instead.
    const types = ["snapshot", "person-started", "person-done", "dates", "complete", "failed"];
    for (const t of types) source.addEventListener(t, handler as EventListener);
    source.onerror = () => {
      // EventSource retries by itself. If the run already finished between
      // polls, the run page (not this component) shows the result.
      if (source.readyState === EventSource.CLOSED) clearInterval(timer);
    };
    return () => {
      clearInterval(timer);
      source.close();
    };
  }, [runId, onDone]);

  const pct = state.total > 0 ? Math.min(100, Math.round((state.done / state.total) * 100)) : 0;

  return (
    <div className="panel" role="status" aria-live="polite">
      <h3 className="mb0">
        {state.failed ? "This run could not finish" : state.finished ? "Run complete" : "Reading profiles live…"}
      </h3>
      {!state.failed && !state.finished && (
        <>
          <div className="bar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="small dim">
            {state.done} of {state.total} {state.total === 1 ? "person" : "people"} read
            {state.ready > 0 ? ` · ${state.ready} readable` : ""}
            {state.sessions > 0 ? ` · ${state.sessions} dates planned` : ""}
            {elapsed > 0 ? ` · ${elapsed}s so far` : ""}
          </p>
          {state.current && <p className="small mono">reading {state.current}…</p>}
        </>
      )}
      {state.failed && <p className="small">{state.error ?? "Something went wrong while processing this run."}</p>}
    </div>
  );
}
