"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DateSession, MatchScore, PersonRecord, Run } from "@/core/types";

type Tab = "profiles" | "dates" | "rankings";

/**
 * The run view is deep-linkable: /run/<id>?view=dates&person=<id> opens a
 * specific tab and person. That makes a profile or a single date shareable,
 * and lets a video capture a known state without scripting clicks.
 */
function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function RunClient({ run }: { run: Run }) {
  const [tab, setTab] = useState<Tab>("profiles");
  const [selected, setSelected] = useState<string | null>(null);

  const people = useMemo(
    () => [...run.people].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "")),
    [run.people],
  );
  const ready = useMemo(() => people.filter((p) => p.status === "ready"), [people]);
  // People we could not read must be shown, not silently dropped. Hiding them
  // left a bare number in a stat tile with no name, reason or next step.
  const unreadable = useMemo(() => people.filter((p) => p.status !== "ready"), [people]);

  // Deduplicate sessions; they are attached to both participants.
  const sessions = useMemo(() => {
    const map = new Map<string, DateSession>();
    for (const p of people) {
      for (const s of p.sessions ?? []) if (!map.has(s.id)) map.set(s.id, s);
    }
    return [...map.values()];
  }, [people]);

  // Honour ?view= and ?person= on mount.
  useEffect(() => {
    const v = readParam("view");
    if (v === "dates" || v === "rankings" || v === "profiles") setTab(v);
    const p = readParam("person");
    if (p && people.some((x) => x.id === p)) setSelected(p);
  }, [people]);

  // Keep the URL in step so the current view is always shareable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (tab === "profiles") url.searchParams.delete("view");
    else url.searchParams.set("view", tab);
    if (selected && selected !== ready[0]?.id) url.searchParams.set("person", selected);
    else url.searchParams.delete("person");
    window.history.replaceState(null, "", url.toString());
  }, [tab, selected, ready]);

  if (ready.length === 0) {
    return (
      <div className="panel empty">
        <h2>No readable profiles</h2>
        <p>
          Everyone submitted could not be read. This is usually because both platforms block anonymous automated reads —
          add the visible profile text on the start page to see it work.
        </p>
      </div>
    );
  }

  const active = ready.find((p) => p.id === selected) ?? ready[0]!;
  const nameOf = (id: string) => ready.find((p) => p.id === id)?.displayName ?? "this person";

  const unreadableBlock = unreadable.length > 0 && (
    <section className="panel" style={{ marginTop: 16, borderColor: "rgba(245,158,11,.35)" }}>
      <h3 style={{ color: "var(--warn)" }}>Could not read {unreadable.length} profile{unreadable.length === 1 ? "" : "s"}</h3>
      <p className="small">
        These people were submitted but neither source could be read, so no analysis exists and their agent is not in
        the dating pool. Nothing was invented for them.
      </p>
      <ul className="clean">
        {unreadable.map((p) => (
          <li key={p.id}>
            <b style={{ color: "var(--text)" }}>{p.linkedinUrl.replace("https://www.linkedin.com/in/", "")}</b>
            <div className="evidence">{p.error ?? "The profile could not be read."}</div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <div className="nav" style={{ marginBottom: 18 }} role="tablist" aria-label="Run views">
        <button
          className={`btn btn-sm ${tab === "profiles" ? "btn-primary" : ""}`}
          onClick={() => setTab("profiles")}
          type="button"
          role="tab"
          aria-selected={tab === "profiles"}
        >
          Profiles ({ready.length})
        </button>
        <button
          className={`btn btn-sm ${tab === "dates" ? "btn-primary" : ""}`}
          onClick={() => setTab("dates")}
          type="button"
          role="tab"
          aria-selected={tab === "dates"}
        >
          Dates ({sessions.length})
        </button>
        <button
          className={`btn btn-sm ${tab === "rankings" ? "btn-primary" : ""}`}
          onClick={() => setTab("rankings")}
          type="button"
          role="tab"
          aria-selected={tab === "rankings"}
        >
          Rankings
        </button>
      </div>

      {tab === "profiles" && (
        <div className="two-col">
          <nav className="list-nav">
            {ready.map((p) => (
              <a
                key={p.id}
                href={`?view=profiles&person=${p.id}`}
                aria-current={p.id === active.id ? "true" : undefined}
                className={p.id === active.id ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  setSelected(p.id);
                  document.getElementById("person-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {p.displayName ?? p.id}
              </a>
            ))}
          </nav>
          <div id="person-detail" key={active.id}>
            <PersonPanel person={active} nameOf={nameOf} />
          </div>
        </div>
      )}

      {tab === "dates" && (
        <div>
          {sessions.length === 0 ? (
            <div className="panel empty">
              <h2>No dates yet</h2>
              <p>Dates are planned once at least two people have a readable profile.</p>
            </div>
          ) : (
            <div className="grid grid-2">
              {sessions.map((s) => (
                <SessionPanel key={s.id} session={s} nameOf={nameOf} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "rankings" && (
        <div className="two-col">
          <nav className="list-nav">
            {ready.map((p) => (
              <a
                key={p.id}
                href={`?view=rankings&person=${p.id}`}
                aria-current={p.id === active.id ? "true" : undefined}
                className={p.id === active.id ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  setSelected(p.id);
                }}
              >
                {p.displayName ?? p.id}
              </a>
            ))}
          </nav>
          <div>
            <RankingPanel person={active} nameOf={nameOf} />
          </div>
        </div>
      )}

      {unreadableBlock}
    </>
  );
}

function SourceLinks({ person }: { person: PersonRecord }) {
  const li = person.analysis?.sources.linkedin;
  const ig = person.analysis?.sources.instagram;
  return (
    <div className="tag-row">
      <a className="chip" href={person.linkedinUrl} target="_blank" rel="noreferrer noopener">
        LinkedIn ↗
      </a>
      <a className="chip" href={person.instagramUrl} target="_blank" rel="noreferrer noopener">
        Instagram ↗
      </a>
      {li?.status === "unavailable" && (
        <span className="chip chip-warn" title={li.reason}>
          LinkedIn unread
        </span>
      )}
      {ig?.status === "unavailable" && (
        <span className="chip chip-warn" title={ig.reason}>
          Instagram unread
        </span>
      )}
      {li?.provider && <span className="chip">via {li.provider}</span>}
    </div>
  );
}

function TraitList({
  title,
  items,
  empty,
}: {
  title: string;
  items: readonly { key: string; label: string; confidence: number; evidence: readonly { source: string; quote: string; line?: number }[] }[];
  empty: string;
}) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="small dim mb0">{empty}</p>
      ) : (
        <ul className="clean">
          {items.map((t) => (
            <li key={t.key}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ color: "var(--text)" }}>{t.label}</span>
                <span className="mono dim small">{Math.round(t.confidence * 100)}%</span>
              </div>
              {t.evidence.length > 0 && (
                <div className="evidence">
                  {t.evidence.map((e, i) => (
                    <div key={i} style={{ marginTop: i === 0 ? 0 : 4 }}>
                      &ldquo;{e.quote}&rdquo;{" "}
                      <span className="src">
                        {e.source} · line {(e.line ?? 0) + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonPanel({ person, nameOf }: { person: PersonRecord; nameOf: (id: string) => string }) {
  const a = person.analysis;
  if (!a) {
    return (
      <div className="panel">
        <h3>{person.displayName ?? person.id}</h3>
        <p className="small">{person.error}</p>
      </div>
    );
  }

  return (
    <div>
      <section className="panel">
        <h2 style={{ fontSize: 26, marginBottom: 4 }}>{a.displayName}</h2>
        {a.headline ? <p className="small mb0">{a.headline}</p> : <p className="small dim mb0">No headline captured.</p>}
        {a.location ? <p className="small dim mb0">{a.location}</p> : null}
        <div style={{ marginTop: 12 }}>
          <SourceLinks person={person} />
        </div>
        <p className="small dim" style={{ marginTop: 12, marginBottom: 0 }}>
          Analysed from {a.sources.linkedin.status === "captured" ? "LinkedIn" : "no LinkedIn data"} +{" "}
          {a.sources.instagram.status === "captured" ? "Instagram" : "no Instagram data"} · {a.traits.length} cited
          traits · engine: {a.engine}
        </p>
      </section>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <TraitList title="Hobbies" items={a.hobbies} empty="Neither profile states a hobby." />
        <TraitList title="Interests" items={a.interests} empty="Neither profile names an interest." />
        <TraitList title="Values" items={a.values} empty="Neither profile states a value." />
        <div className="panel">
          <h3>What the agent is looking for</h3>
          {a.needs.length === 0 ? (
            <p className="small dim mb0">No needs could be derived, because no hobby or interest was evidenced.</p>
          ) : (
            <ul className="clean">
              {a.needs.map((n) => (
                <li key={n.key}>
                  <span style={{ color: "var(--text)" }}>{n.label}</span>
                  {n.evidence[0] && (
                    <div className="evidence">
                      from &ldquo;{n.evidence[0].quote}&rdquo; <span className="src">({n.evidence[0].source})</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h3>What the two sources do not say</h3>
        <ul className="clean">
          {a.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h3>Dates this agent went on ({person.sessions?.length ?? 0})</h3>
        {(person.sessions ?? []).length === 0 ? (
          <p className="small dim mb0">No dates yet — they are planned once two people are readable.</p>
        ) : (
          <ul className="clean">
            {(person.sessions ?? []).map((s) => {
              const other = s.personAId === person.id ? s.personBId : s.personAId;
              return (
                <li key={s.id}>
                  vs {nameOf(other)} · score {s.evaluation?.overall ?? "—"}
                </li>
              );
            })}
          </ul>
        )}
        <p className="small dim" style={{ marginTop: 10, marginBottom: 0 }}>
          {(person.matches?.length ?? 0) > 0 ? (
            <>
              This person ranks {person.matches!.length} other {person.matches!.length === 1 ? "person" : "people"}.
              Switch to the Rankings tab to see the full order.
            </>
          ) : (
            <>Nobody else could be read, so there is no shortlist yet. Add at least one more readable person.</>
          )}
        </p>
      </section>
    </div>
  );
}

function SessionPanel({ session, nameOf }: { session: DateSession; nameOf: (id: string) => string }) {
  const aName = nameOf(session.personAId);
  const bName = nameOf(session.personBId);
  return (
    <section className="panel">
      <div className="entry-head">
        <h3 style={{ marginBottom: 0 }}>
          {aName} <span className="dim">×</span> {bName}
        </h3>
        {session.evaluation && <span className="score-pill">{session.evaluation.overall}</span>}
      </div>
      {session.evaluation && (
        <div className="tag-row" style={{ marginTop: 0, marginBottom: 10 }}>
          <span className="chip">shared ground {Math.round(session.evaluation.sharedGround * 100)}%</span>
          <span className="chip">reciprocity {Math.round(session.evaluation.reciprocity * 100)}%</span>
          <span className="chip">mismatch risk {Math.round(session.evaluation.mismatchRisk * 100)}%</span>
        </div>
      )}
      <div className="transcript">
        {session.turns.map((t) => (
          <div key={t.seq} className={`turn ${t.role === "A" ? "a" : "b"}`}>
            <div className="turn-head">
              <span className="speaker">{t.role === "A" ? aName : bName}</span>
              <span className="move-tag">{t.move.replace("_", " ")}</span>
            </div>
            <p>{t.text}</p>
            {t.evidence.length > 0 && (
              <div className="evidence">
                grounded in:{" "}
                {t.evidence.map((e) => `“${e.quote.slice(0, 90)}${e.quote.length > 90 ? "…" : ""}”`).join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>
      {session.evaluation && session.evaluation.notes.length > 0 && (
        <details className="disclose">
          <summary>Evaluation notes</summary>
          <ul className="clean" style={{ marginTop: 8 }}>
            {session.evaluation.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function RankingPanel({ person, nameOf }: { person: PersonRecord; nameOf: (id: string) => string }) {
  const matches = person.matches ?? [];
  if (matches.length === 0) {
    return (
      <div className="panel">
        <h3>{person.displayName ?? person.id}</h3>
        <p className="small dim mb0">
          A shortlist needs at least two readable people. Add another person and their agents will date, then everyone
          gets ranked.
        </p>
      </div>
    );
  }

  return (
    <div>
      <section className="panel">
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>{person.displayName} ranks</h2>
        <p className="small dim mb0">
          Directed scoring: this list is {person.displayName}&apos;s view, and is not the same as anyone else&apos;s list.
          Uncertainty is shown because a thin profile produces a thinner ranking.
        </p>
      </section>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        {matches.map((m: MatchScore, i: number) => (
          <section className="panel person-card" key={m.candidateId}>
            <div className="person-top">
              <div>
                <div className="person-name">
                  {i + 1}. {nameOf(m.candidateId)}
                </div>
                <div className="person-sub">{m.overall >= 0.7 ? "Strong fit" : m.overall >= 0.5 ? "Plausible" : "Weak fit"}</div>
              </div>
              <span className="score-pill">{m.overall.toFixed(2)}</span>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.round(m.overall * 100)}%` }} />
            </div>
            <details className="disclose">
              <summary>Why ({m.components.length} factors)</summary>
              <ul className="clean" style={{ marginTop: 8 }}>
                {m.components.map((c) => (
                  <li key={c.label}>
                    <b style={{ color: "var(--text)" }}>{c.label}</b> · {Math.round(c.score * c.weight * 100)} pts
                    <div className="evidence">{c.detail}</div>
                  </li>
                ))}
              </ul>
              {m.evidence.length > 0 && (
                <div className="evidence">
                  <b>Evidence</b>
                  <div className="src">
                    {m.evidence
                      .map(
                        (e) =>
                          `“${e.quote.slice(0, 70)}${e.quote.length > 70 ? "…" : ""}” (${e.source})`,
                      )
                      .join(" · ")}
                  </div>
                </div>
              )}
            </details>
          </section>
        ))}
      </div>
    </div>
  );
}
