"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Entry {
  key: number;
  name: string;
  linkedin: string;
  instagram: string;
  linkedinText: string;
  instagramText: string;
  showText: boolean;
}

let seq = 0;
const blank = (showText = false): Entry => ({
  key: seq++,
  name: "",
  linkedin: "",
  instagram: "",
  linkedinText: "",
  instagramText: "",
  showText,
});

/**
 * Two example people, not one. A single-person run produces no dates and no
 * rankings, so a one-person sample demonstrated the one thing the page says
 * is not the point.
 */
const SAMPLE_PEOPLE = [
  {
    name: "Alex Rivera",
    linkedin: "linkedin.com/in/example-runner",
    instagram: "instagram.com/example.runner",
    linkedinText: [
      "Alex Rivera",
      "Backend engineer at a fintech scale-up",
      "Trail running, bouldering and natural wine fill the weekends.",
      "Skills: Go, Postgres, Kubernetes.",
      "Mentoring two junior engineers through a local programme.",
    ].join("\n"),
    instagramText: [
      "Alex Rivera",
      "Runner. Climber. Coffee obsessive.",
      "Six weeks to a sub-3 marathon. Bouldering four times a week.",
      "New coffee spot in Marylebone did not disappoint.",
    ].join("\n"),
  },
  {
    name: "Rowan Ellis",
    linkedin: "linkedin.com/in/example-designer",
    instagram: "instagram.com/example.designer",
    linkedinText: [
      "Rowan Ellis",
      "Product designer at a small studio",
      "Trail running, natural wine and throwing pots on weekday evenings.",
      "Mentoring a design student through a local programme.",
    ].join("\n"),
    instagramText: [
      "Rowan Ellis",
      "Trail runner. Wine. Making ceramics.",
      "Six weeks to a sub-3 marathon. New roastery did not disappoint.",
    ].join("\n"),
  },
] as const;

/** Must match the zod cap in src/app/api/runs/route.ts. */
const MAX_PEOPLE = 20;

export default function StartForm({ captureEnabled }: { captureEnabled: boolean }) {
  const router = useRouter();
  // When automatic capture is off, pasted text is the ONLY way a profile gets
  // read. The notice told users to paste, but the textareas were hidden behind
  // a ghost "Add profile text" button, so the working path needed a click to
  // discover. Open them by default in that case.
  const [entries, setEntries] = useState<Entry[]>(() => [blank(!captureEnabled)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ index: number; field: string; message: string }[]>([]);
  const [showMethod, setShowMethod] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);

  // The error used to render at the top of a panel that grows with each person
  // added, leaving it up to 1000px above the button the user just pressed. It
  // looked like the click did nothing, so pull it into view on every failure.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  function update(key: number, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function add() {
    // The API caps a run at 20; do not let a user build a form that is
    // guaranteed to be rejected on submit.
    setEntries((prev) => (prev.length >= MAX_PEOPLE ? prev : [...prev, blank(!captureEnabled)]));
  }

  function remove(key: number) {
    setEntries((prev) => (prev.length === 1 ? prev : prev.filter((e) => e.key !== key)));
  }

  function loadSample() {
    setEntries(
      SAMPLE_PEOPLE.slice(0, MAX_PEOPLE).map((person) => ({
        ...blank(),
        name: person.name,
        linkedin: person.linkedin,
        instagram: person.instagram,
        linkedinText: person.linkedinText,
        instagramText: person.instagramText,
        showText: true,
      })),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const payload = {
        entries: entries.map((e) => ({
          name: e.name || undefined,
          linkedin: e.linkedin,
          instagram: e.instagram,
          linkedinText: e.linkedinText || undefined,
          instagramText: e.instagramText || undefined,
        })),
      };
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setIssues(data.issues ?? []);
        setError(data.error ?? "Something went wrong.");
        setBusy(false);
        return;
      }
      router.push(`/run/${data.runId}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="page-head">
        <p className="eyebrow">Start a run</p>
        <h1>
          Every profile gets an agent.
          <br />
          The agents date on their behalf.
        </h1>
      </div>
      <p className="lede">
        Paste one LinkedIn and one public Instagram per person. Each agent reads those two profiles, works out needs,
        hobbies and interests with citations, and then dates the other agents. You get a profile page per person and a
        ranked shortlist of who fits them best.
      </p>

      {!captureEnabled && (
        <div className="notice notice-warn">
          <b>Automatic capture is off in this deployment.</b> LinkedIn returns HTTP 999 to automated readers and
          Instagram serves a JavaScript-only page, so a link alone cannot be read without a paid scraping credential.{" "}
          <b>
            Paste the visible profile text into the LinkedIn and Instagram boxes on each person below
            {entries.every((e) => e.showText) ? " (they are already open)" : " — press Add profile text to open them"}
          </b>
          , and everything else works identically: analysis, dating and rankings. This deployment reads pasted text only.
        </div>
      )}

      <div className="facts">
        <div className="fact">
          <b>2</b>
          <span>sources read per person</span>
          <span className="fact-sub">when both can be read</span>
        </div>
        <div className="fact">
          <b>100%</b>
          <span>of profile traits cited</span>
          <span className="fact-sub">every trait, every run</span>
        </div>
        <div className="fact">
          <b>n−1</b>
          <span>ranked per person</span>
        </div>
        <div className="fact">
          <b>0</b>
          <span>No sensitive guesses</span>
          <span className="fact-sub">age, orientation or status</span>
        </div>
      </div>

      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="entry-head">
          <h2 className="mb0">Add people</h2>
          <div className="cluster">
            <button className="btn btn-sm" onClick={loadSample} type="button">
              Fill example
            </button>
            <button className="btn btn-sm" onClick={add} type="button" disabled={entries.length >= MAX_PEOPLE}>
              + Add person
            </button>
          </div>
        </div>
        {entries.length >= MAX_PEOPLE && (
          <p className="small dim mb0">
            {MAX_PEOPLE} people is the per-run limit.
          </p>
        )}

        {error ? (
          <div className="notice notice-error" role="alert" ref={errorRef}>
            <b>{error}</b>
            {issues.length > 0 && (
              <ul className="clean">
                {issues.map((iss, i) => (
                  <li key={i}>
                    Person {iss.index + 1} — {iss.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {entries.map((entry, index) => (
          <div className="entry" key={entry.key}>
            <div className="entry-head">
              <b>Person {index + 1}</b>
              {entries.length > 1 ? (
                <button className="btn btn-sm btn-ghost" onClick={() => remove(entry.key)} type="button">
                  Remove
                </button>
              ) : null}
            </div>

            <div className="row">
              <label className="field">
                <span>Name (optional)</span>
                <input
                  type="text"
                  value={entry.name}
                  placeholder="Their first and last name"
                  onChange={(ev) => update(entry.key, { name: ev.target.value })}
                />
              </label>
              <label className="field">
                <span>LinkedIn profile URL</span>
                <input
                  type="text"
                  value={entry.linkedin}
                  placeholder="linkedin.com/in/username"
                  onChange={(ev) => update(entry.key, { linkedin: ev.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Instagram profile URL</span>
              <input
                type="text"
                value={entry.instagram}
                placeholder="instagram.com/username"
                onChange={(ev) => update(entry.key, { instagram: ev.target.value })}
              />
            </label>

            <button
              className="btn btn-sm btn-ghost"
              type="button"
              aria-expanded={entry.showText}
              aria-controls={`person-${entry.key}-text`}
              onClick={() => update(entry.key, { showText: !entry.showText })}
            >
              {entry.showText ? "Hide" : "Add"} profile text {entry.showText ? "▲" : "▼"}
            </button>

            {entry.showText && (
              <div id={`person-${entry.key}-text`} className="mt16">
                <p className="small dim">
                  Both platforms block anonymous automated reads, so pasting the visible profile text is how a person
                  consents to being read. Paste only what their profile already shows publicly.
                </p>
                <div className="row">
                  <label className="field">
                    <span>LinkedIn — visible profile text</span>
                    <textarea
                      value={entry.linkedinText}
                      placeholder={"Name\nHeadline\nAbout / experience / skills"}
                      onChange={(ev) => update(entry.key, { linkedinText: ev.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Instagram — bio and captions</span>
                    <textarea
                      value={entry.instagramText}
                      placeholder={"Display name\nBio\nRecent captions"}
                      onChange={(ev) => update(entry.key, { instagramText: ev.target.value })}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="cluster mt16">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Reading profiles…" : "Read profiles and start dating"}
          </button>
          <span className="small dim">Add 2+ people to get rankings. A single person still gets a profile page.</span>
        </div>
      </form>

      <section className="panel">
        <button
          className="btn btn-sm btn-ghost"
          aria-expanded={showMethod}
          aria-controls="capture-method"
          onClick={() => setShowMethod((v) => !v)}
          type="button"
        >
          {showMethod ? "Hide" : "Why"} pasting may be necessary
        </button>
        {showMethod && (
          <div id="capture-method" className="mt16">
            <p className="small">
              Measured against the live web while building this: <b>LinkedIn returns HTTP 999</b>, its bot-block
              response, for anonymous requests. <b>Instagram returns a JavaScript-only page</b> with no profile text and
              its JSON endpoint answers 401. So a shared link alone cannot be read by a third party without paid
              credentials.
            </p>
            <p className="small mb0">
              This build therefore captures in order: an Apify adapter when <code className="mono">APIFY_TOKEN</code> is
              set, a plain anonymous read, then pasted profile text, which needs no credentials. A source that cannot be
              read is reported, never invented.
            </p>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Want to see it populated first?</h2>
        <p className="small">
          The demo run is already finished: 26 people, their analysed profiles, the dates their agents went on, and every
          person&apos;s ranked shortlist.
        </p>
        <Link className="btn btn-primary" href="/demo">
          Open the live demo
        </Link>
      </section>
    </main>
  );
}
