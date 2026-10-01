"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { DateSession, MatchScore, PersonRecord, Run } from "@/core/types";

type Tab = "profiles" | "dates" | "rankings";

/**
 * The run view is deep-linkable: /run/<id>?view=dates&person=<id> opens a
 * specific tab and person. The server reads those params and passes them in
 * so the first paint, a share preview and a crawler all agree with the link.
 */

export default function RunClient({
  run,
  initialView = "profiles",
  initialPerson = null,
}: {
  run: Run;
  initialView?: Tab;
  initialPerson?: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialView);
  const [selected, setSelected] = useState<string | null>(initialPerson);

  function onTabsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();
    const order: Tab[] = ["profiles", "dates", "rankings"];
    const current = order.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? order[(current + 1) % order.length]!
        : event.key === "ArrowLeft"
          ? order[(current + order.length - 1) % order.length]!
          : event.key === "Home"
            ? "profiles"
            : "rankings";
    setTab(next);
    document.getElementById(`run-tab-${next}`)?.focus();
  }

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

  // ?view= and ?person= are read on the server and passed in as props, so the
  // first paint already matches the link. Nothing to re-read on mount.

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
    <section className="panel warn-card" aria-label="Unreadable profiles">
      <h3>Could not read {unreadable.length} profile{unreadable.length === 1 ? "" : "s"}</h3>
      <p className="small">
        These people were submitted but neither source could be read, so no analysis exists and their agent is not in
        the dating pool. Nothing was invented for them.
      </p>
      <ul className="clean">
        {unreadable.map((p) => (
          <li key={p.id}>
            <b>{p.linkedinUrl.replace("https://www.linkedin.com/in/", "")}</b>
            <div className="evidence">{p.error ?? "The profile could not be read."}</div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Run views" onKeyDown={onTabsKeyDown}>
        {(
          [
            { id: "profiles", label: "Profiles", count: ready.length },
            { id: "dates", label: "Dates", count: sessions.length },
            { id: "rankings", label: "Rankings", count: undefined },
          ] as { id: Tab; label: string; count?: number }[]
        ).map((item) => (
          <button
            key={item.id}
            id={`run-tab-${item.id}`}
            className={tab === item.id ? "tab active" : "tab"}
            onClick={() => setTab(item.id)}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`run-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
          >
            {item.label}
            {typeof item.count === "number" ? <span className="tab-count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "profiles" && (
        <section id="run-panel-profiles" role="tabpanel" aria-labelledby="run-tab-profiles">
          <div className="people-layout">
            <PersonNav
              people={ready}
              activeId={active.id}
              view="profiles"
              onSelect={(id) => {
                setSelected(id);
                const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                document
                  .getElementById("person-detail")
                  ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
              }}
            />
            <div id="person-detail" key={active.id}>
              <PersonPanel person={active} nameOf={nameOf} />
            </div>
          </div>
        </section>
      )}

      {tab === "dates" && (
        <section id="run-panel-dates" role="tabpanel" aria-labelledby="run-tab-dates">
          {sessions.length === 0 ? (
            <div className="panel empty">
              <h2>No dates yet</h2>
              <p>Dates are planned once at least two people have a readable profile.</p>
            </div>
          ) : (
            <div className="session-list">
              {sessions.map((s) => (
                <SessionPanel key={s.id} session={s} nameOf={nameOf} />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "rankings" && (
        <section id="run-panel-rankings" role="tabpanel" aria-labelledby="run-tab-rankings">
          <div className="people-layout">
            <PersonNav people={ready} activeId={active.id} view="rankings" onSelect={setSelected} />
            <div>
              <RankingPanel person={active} nameOf={nameOf} />
            </div>
          </div>
        </section>
      )}

      {unreadableBlock}
    </>
  );
}

function PersonNav({
  people,
  activeId,
  view,
  onSelect,
}: {
  people: readonly PersonRecord[];
  activeId: string;
  view: "profiles" | "rankings";
  onSelect: (id: string) => void;
}) {
  return (
    <div className="people-nav">
      <p className="eyebrow">People</p>
      <nav className="list-nav" aria-label={`Choose a person for ${view}`}>
        {people.map((p) => (
          <a
            key={p.id}
            href={`?view=${view}&person=${p.id}`}
            aria-current={p.id === activeId ? "true" : undefined}
            className={p.id === activeId ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              onSelect(p.id);
            }}
          >
            {p.displayName ?? p.id}
          </a>
        ))}
      </nav>
    </div>
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
              <div className="trait-row">
                <span className="trait-name">{t.label}</span>
                <span className="trait-confidence">{Math.round(t.confidence * 100)}%</span>
              </div>
              {t.evidence.length > 0 && (
                <div className="evidence">
                  {t.evidence.map((e, i) => (
                    <div key={i} className="evidence-item">
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
        <h2>{a.displayName}</h2>
        {a.headline ? <p className="small mb0">{a.headline}</p> : <p className="small dim mb0">No headline captured.</p>}
        {a.location ? <p className="small dim mb0">{a.location}</p> : null}
        <div className="mt16">
          <SourceLinks person={person} />
        </div>
        <p className="small dim mt16 mb0">
          Analysed from {a.sources.linkedin.status === "captured" ? "LinkedIn" : "no LinkedIn data"} +{" "}
          {a.sources.instagram.status === "captured" ? "Instagram" : "no Instagram data"} · {a.traits.length} cited
          traits · engine: {a.engine}
        </p>
      </section>

      <div className="grid grid-2 mt16">
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
                  <span className="trait-name">{n.label}</span>
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

      <section className="panel mt16">
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
                  vs {nameOf(other)} · date quality {s.evaluation?.overall ?? "—"}
                </li>
              );
            })}
          </ul>
        )}
        <p className="small dim mt16 mb0">
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
        <h3 className="mb0">
          {aName} <span className="dim">×</span> {bName}
        </h3>
        {session.evaluation && <span className="score-pill">{session.evaluation.overall}</span>}
      </div>
      {session.evaluation && (
        <div className="tag-row eval-chips">
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
      {session.evaluation && session.evaluation.notes.length > 0 && (
        <details className="disclose">
          <summary>Evaluation notes</summary>
          <ul className="clean mt8">
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
        <h2>{person.displayName} ranks</h2>
        <p className="small dim mb0">
          Directed scoring: this list is {person.displayName}&apos;s view, and is not the same as anyone else&apos;s list.
          Uncertainty is shown because a thin profile produces a thinner ranking.
        </p>
      </section>

      <div className="grid grid-2 mt16">
        {matches.map((m: MatchScore, i: number) => (
          <section className="panel person-card" key={m.candidateId}>
            <div className="person-top">
              <div>
                <div className="person-name">
                  {i + 1}. {nameOf(m.candidateId)}
                </div>
                <div className="person-sub">
                  {m.overall >= 0.7 ? "Strong fit" : m.overall >= 0.5 ? "Plausible" : "Weak fit"} · fit{" "}
                  {m.overall.toFixed(2)}
                </div>
              </div>
              <span className="score-pill">{m.overall.toFixed(2)}</span>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.round(m.overall * 100)}%` }} />
            </div>
            <details className="disclose">
              <summary>Why ({m.components.length} factors)</summary>
              <ul className="clean mt8">
                {m.components.map((c) => (
                  <li key={c.label}>
                    <b>{c.label}</b> · {Math.round(c.score * c.weight * 100)} pts
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
