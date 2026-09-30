"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Entry {
  key: number;
  linkedin: string;
  instagram: string;
  linkedinText: string;
  instagramText: string;
  showText: boolean;
}

let seq = 0;
const blank = (): Entry => ({
  key: seq++,
  linkedin: "",
  instagram: "",
  linkedinText: "",
  instagramText: "",
  showText: false,
});

const SAMPLES = [
  { name: "Trail runner", linkedin: "linkedin.com/in/example-runner", instagram: "instagram.com/example.runner" },
];

export default function StartPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([blank()]);
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
    setEntries((prev) => [...prev, blank()]);
  }

  function remove(key: number) {
    setEntries((prev) => (prev.length === 1 ? prev : prev.filter((e) => e.key !== key)));
  }

  function loadSample() {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === 0
          ? {
              ...e,
              linkedin: SAMPLES[0]!.linkedin,
              instagram: SAMPLES[0]!.instagram,
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
              showText: true,
            }
          : e,
      ),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const payload = {
        entries: entries.map((e) => ({
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
      <h1>
        Every profile gets an agent.
        <br />
        The agents date on their behalf.
      </h1>
      <p className="lede">
        Paste one LinkedIn and one public Instagram per person. Each agent reads those two profiles, works out needs,
        hobbies and interests with citations, and then dates the other agents. You get a profile page per person and a
        ranked shortlist of who fits them best.
      </p>

      <div className="grid grid-4" style={{ margin: "22px 0 26px" }}>
        <div className="stat">
          <b>2</b>
          <span>sources per person</span>
        </div>
        <div className="stat">
          <b>100%</b>
          <span>claims cited</span>
        </div>
        <div className="stat">
          <b>n−1</b>
          <span>ranked per person</span>
        </div>
        <div className="stat">
          <b>0</b>
          <span>guesses about age, orientation or status</span>
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-ghost" onClick={loadSample} type="button">
              Fill example
            </button>
            <button className="btn btn-sm" onClick={add} type="button">
              + Add person
            </button>
          </div>
        </div>

        {error ? (
          <div className="notice notice-error" role="alert" ref={errorRef}>
            <b>{error}</b>
            {issues.length > 0 && (
              <ul className="clean" style={{ marginTop: 8 }}>
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
                <span>LinkedIn profile URL</span>
                <input
                  type="text"
                  value={entry.linkedin}
                  placeholder="linkedin.com/in/username"
                  onChange={(ev) => update(entry.key, { linkedin: ev.target.value })}
                />
              </label>
              <label className="field">
                <span>Instagram profile URL</span>
                <input
                  type="text"
                  value={entry.instagram}
                  placeholder="instagram.com/username"
                  onChange={(ev) => update(entry.key, { instagram: ev.target.value })}
                />
              </label>
            </div>

            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => update(entry.key, { showText: !entry.showText })}
            >
              {entry.showText ? "Hide" : "Add"} profile text {entry.showText ? "▲" : "▼"}
            </button>

            {entry.showText && (
              <>
                <p className="small dim" style={{ margin: "10px 0 8px" }}>
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
              </>
            )}
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Reading profiles…" : "Read profiles and start dating"}
          </button>
          <span className="small dim">Add 2+ people to get rankings. A single person still gets a profile page.</span>
        </div>
      </form>

      <section className="panel">
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setShowMethod((v) => !v)}
          type="button"
        >
          {showMethod ? "Hide" : "Why"} pasting may be necessary
        </button>
        {showMethod && (
          <div style={{ marginTop: 12 }}>
            <p className="small">
              Measured against the live web while building this: <b>LinkedIn returns HTTP 999</b>, its bot-block
              response, for anonymous requests. <b>Instagram returns a JavaScript-only page</b> with no profile text and
              its JSON endpoint answers 401. So a shared link alone cannot be read by a third party without paid
              credentials.
            </p>
            <p className="small mb0">
              This build therefore has three capture paths: an Apify adapter (set <code className="mono">APIFY_TOKEN</code>{" "}
              to enable Instagram and consented-profile reads), a consented-text path that works with no credentials,
              and an honest failure that says exactly which source could not be read. It never invents a profile.
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
