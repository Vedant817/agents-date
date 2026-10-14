"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DateSession } from "@/core/types";
import type { DateRunOption } from "./page";

const TURN_MS = 1600;

/**
 * Plays a date transcript live: one turn at a time, with pause, resume,
 * replay and step controls, then the evaluation. Pure presentation over the
 * /api/dates result — the run itself is never modified.
 */
export default function DatePlayer({
  runs,
  initial,
}: {
  runs: DateRunOption[];
  initial: { runId: string; a: string; b: string } | null;
}) {
  const [runId, setRunId] = useState(initial?.runId ?? runs[0]!.id);
  const [a, setA] = useState(initial?.a ?? "");
  const [b, setB] = useState(initial?.b ?? "");
  const [session, setSession] = useState<DateSession | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useMemo(() => runs.find((r) => r.id === runId) ?? runs[0]!, [runs, runId]);
  const names = useMemo(() => new Map(run.people.map((p) => [p.id, p.name])), [run]);
  const nameOf = (id: string) => names.get(id) ?? "this person";

  // Keep the current pairing shareable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("run", runId);
    if (a) url.searchParams.set("a", a);
    else url.searchParams.delete("a");
    if (b) url.searchParams.set("b", b);
    else url.searchParams.delete("b");
    window.history.replaceState(null, "", url.toString());
  }, [runId, a, b]);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!playing || !session) return;
    if (revealed >= session.turns.length) {
      setPlaying(false);
      return;
    }
    timer.current = setInterval(() => {
      setRevealed((n) => {
        if (!session || n >= session.turns.length) {
          if (timer.current) clearInterval(timer.current);
          setPlaying(false);
          return n;
        }
        const next = n + 1;
        if (next >= session.turns.length && timer.current) {
          clearInterval(timer.current);
          setPlaying(false);
        }
        return next;
      });
    }, TURN_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, session, revealed]);

  // A new pairing invalidates the old date.
  useEffect(() => {
    setSession(null);
    setRevealed(0);
    setPlaying(false);
    setError(null);
  }, [runId, a, b]);

  async function start() {
    if (!a || !b) {
      setError("Pick two people first.");
      return;
    }
    if (a === b) {
      setError("Pick two different people — nobody dates themselves.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, a, b }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start that date.");
        setLoading(false);
        return;
      }
      setSession(data.session as DateSession);
      setRevealed(0);
      setPlaying(true);
      setLoading(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  const people = run.people;
  const finished = session !== null && revealed >= session.turns.length;

  return (
    <div>
      <section className="panel">
        <div className="row">
          <label className="field">
            <span>Run</span>
            <select value={runId} onChange={(e) => setRunId(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id === "demo" ? r.label : `Run · ${r.label}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>First person</span>
            <select value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Second person</span>
            <select value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="cluster mt16">
          <button className="btn btn-primary" type="button" onClick={() => void start()} disabled={loading || !a || !b}>
            {loading ? "Asking their agents…" : session ? "Date again" : "Start the date"}
          </button>
          {session && !playing && !finished && (
            <button className="btn btn-sm" type="button" onClick={() => setPlaying(true)}>
              Resume
            </button>
          )}
          {session && playing && (
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => {
                if (timer.current) clearInterval(timer.current);
                setPlaying(false);
              }}
            >
              Pause
            </button>
          )}
          {session && (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setRevealed((n) => Math.min(n + 1, session.turns.length));
                if (timer.current) clearInterval(timer.current);
                setPlaying(false);
              }}
            >
              Step ▸
            </button>
          )}
          {session && finished && (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setRevealed(0);
                setPlaying(true);
              }}
            >
              Replay
            </button>
          )}
        </div>
        {error && (
          <div className="notice notice-error mt16" role="alert">
            {error}
          </div>
        )}
      </section>

      {session && (
        <section className="panel mt16" aria-live="polite">
          <div className="entry-head">
            <h3 className="mb0">
              {playing && !finished && (
                <span className="live-dot" aria-hidden="true" />
              )}
              {nameOf(session.personAId)} <span className="dim">×</span> {nameOf(session.personBId)}
            </h3>
            {finished && session.evaluation && (
              <span className="score-pill">{session.evaluation.overall}</span>
            )}
          </div>
          {!finished && (
            <div
              className="playback-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={session.turns.length}
              aria-valuenow={revealed}
              aria-label={`Turn ${Math.min(revealed + 1, session.turns.length)} of ${session.turns.length}`}
            >
              <i style={{ width: `${Math.round((revealed / Math.max(1, session.turns.length)) * 100)}%` }} />
            </div>
          )}
          <div className="transcript">
            {session.turns.slice(0, revealed).map((t, i) => (
              <div
                key={t.seq}
                className={`turn ${t.role === "A" ? "a" : "b"}${i === revealed - 1 && playing ? " turn-live" : ""}`}
              >
                <div className="turn-head">
                  <span className="speaker">{t.role === "A" ? nameOf(session.personAId) : nameOf(session.personBId)}</span>
                  <span className="move-tag">{t.move.replace("_", " ")}</span>
                </div>
                <p>{t.text}</p>
                {t.evidence.length > 0 && (
                  <div className="evidence">
                    {t.evidence.map((e, i) => (
                      <div key={i} className="evidence-item">
                        &ldquo;{e.quote.slice(0, 90)}
                        {e.quote.length > 90 ? "…" : ""}&rdquo;{" "}
                        <span className="src">
                          {nameOf(e.personId)} · {e.source} · line {(e.line ?? 0) + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!finished && (
            <p className="small dim">
              Turn {Math.min(revealed + 1, session.turns.length)} of {session.turns.length}…
            </p>
          )}
          {finished && session.evaluation && (
            <>
              <div className="tag-row eval-chips">
                <span className="chip">shared ground {Math.round(session.evaluation.sharedGround * 100)}%</span>
                <span className="chip">reciprocity {Math.round(session.evaluation.reciprocity * 100)}%</span>
                <span className="chip">mismatch risk {Math.round(session.evaluation.mismatchRisk * 100)}%</span>
              </div>
              {session.evaluation.notes.length > 0 && (
                <details className="disclose">
                  <summary>Evaluation notes</summary>
                  <ul className="clean mt8">
                    {session.evaluation.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="small dim mt16 mb0">
                Computed fresh just now — this date is not stored in the run.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
