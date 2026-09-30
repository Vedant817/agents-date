"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DateSession, MatchScore, PersonRecord, Run } from "@/core/types";

type Tab = "profiles" | "dates" | "rankings";

export default function RunClient({ run }: { run: Run }) {
  const [tab, setTab] = useState<Tab>("profiles");
  const [selected, setSelected] = useState<string | null>(null);

  const people = useMemo(
    () => [...run.people].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "")),
    [run.people],
  );
  const ready = useMemo(() => people.filter((p) => p.status === "ready"), [people]);

  // Deduplicate sessions; they are attached to both participants.
  const sessions = useMemo(() => {
    const map = new Map<string, DateSession>();
    for (const p of people) {
      for (const s of p.sessions ?? []) if (!map.has(s.id)) map.set(s.id, s);
    }
    return [...map.values()];
  }, [people]);

  if (ready.length === 0) return null;

  const active = ready.find((p) => p.id === selected) ?? ready[0]!;
  const nameOf = (id: string) => ready.find((p) => p.id === id)?.displayName ?? "Unknown";

  return (
    <>
      <div className="nav" style={{ marginBottom: 18 }}>
        <button className={`btn btn-sm ${tab === "profiles" ? "btn-primary" : ""}`} onClick={() => setTab("profiles")} type="button">
          Profiles ({ready.length})
        </button>
        <button className={`btn btn-sm ${tab === "dates" ? "btn-primary" : ""}`} onClick={() => setTab("dates")} type="button">
          Dates ({sessions.length})
        </button>
        <button className={`btn btn-sm ${tab === "rankings" ? "btn-primary" : ""}`} onClick={() => setTab("rankings")} type="button">
          Rankings
        </button>
      </div>

      {tab === "profiles" && (
        <div className="two-col">
          <nav className="list-nav">
            {ready.map((p) => (
              <a
                key={p.id}
                href={`#${p.id}`}
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
          <div id="person-detail">
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
                href={`#rank-${p.id}`}
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
              {t.evidence[0] && (
                <div className="evidence">
                  &ldquo;{t.evidence[0].quote}&rdquo;
                  <div className="src">
                    {t.evidence[0].source} · line {(t.evidence[0].line ?? 0) + 1}
                  </div>
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
          This person ranks {(person.matches?.length ?? 0)} other people. Switch to the Rankings tab to see the full order.
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
                grounded in: {t.evidence.map((e) => `“${e.quote.slice(0, 90)}${e.quote.length > 90 ? "…" : ""}”`).join(" · ")}
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
          Needs at least one other readable person before a shortlist can be built.
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
                  <div className="src">{m.evidence.map((e) => `“${e.quote.slice(0, 70)}${e.quote.length > 70 ? "…" : ""}” (${e.source})`).join(" · ")}</div>
                </div>
              )}
            </details>
          </section>
        ))}
      </div>
    </div>
  );
}
