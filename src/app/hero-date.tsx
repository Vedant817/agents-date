"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DateSession } from "@/core/types";
import { trailerFor } from "@/dating/engine";

/**
 * The ten-second hook: a real date playing itself above the form, so value
 * precedes labor. Autoplays once (no loop — a loop would cheapen it), then
 * offers replay, a new surprise pairing from the same run, or the full
 * instant-date page. Renders nothing when there is no showcase date.
 */
export default function HeroDate({
  session,
  aName,
  bName,
  dateUrl,
}: {
  session: DateSession;
  aName: string;
  bName: string;
  dateUrl: string;
}) {
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const trailer = trailerFor(session);
  const finished = revealed >= session.turns.length;

  useEffect(() => {
    if (!playing) return;
    if (revealed >= session.turns.length) {
      setPlaying(false);
      return;
    }
    timer.current = setInterval(() => {
      setRevealed((n) => {
        const next = Math.min(n + 1, session.turns.length);
        if (next >= session.turns.length && timer.current) {
          clearInterval(timer.current);
          setPlaying(false);
        }
        return next;
      });
    }, 900);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, revealed, session.turns.length]);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  return (
    <section className="panel hero-date" aria-label="A date playing live">
      <div className="entry-head">
        <h3 className="mb0">
          {playing && !finished && <span className="live-dot" aria-hidden="true" />}
          {aName}’s agent <span className="dim">×</span> {bName}’s agent
        </h3>
        {finished && trailer && (
          <span className="chip chip-accent">
            {trailer.verdict} · {trailer.overall.toFixed(2)}
          </span>
        )}
      </div>
      <div className="transcript">
        {session.turns.slice(0, revealed).map((t, i) => (
          <div
            key={t.seq}
            className={`turn ${t.role === "A" ? "a" : "b"}${i === revealed - 1 && playing ? " turn-live" : ""}`}
          >
            <div className="turn-head">
              <span className="speaker">
                {t.role === "A" ? `${aName}’s agent` : `${bName}’s agent`}
              </span>
              <span className="move-tag">{t.move.replace("_", " ")}</span>
            </div>
            <p>{t.text}</p>
          </div>
        ))}
      </div>
      <div className="cluster mt16">
        {finished ? (
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setRevealed(0);
              setPlaying(true);
            }}
          >
            Replay
          </button>
        ) : (
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              if (timer.current) clearInterval(timer.current);
              setPlaying(false);
              setRevealed(session.turns.length);
            }}
          >
            Skip to verdict
          </button>
        )}
        <Link className="btn btn-sm btn-ghost" href={dateUrl}>
          Date these two yourself
        </Link>
        <Link className="btn btn-sm btn-ghost" href="/demo">
          Meet everyone
        </Link>
      </div>
      <p className="small dim mt8 mb0">Simulated conversation — no person said any of this.</p>
    </section>
  );
}
