"use client";

import { useState } from "react";

/**
 * Copies a run's share link. Falls back to showing the URL inline when the
 * clipboard API is unavailable, so the link is never trapped — and never
 * steals focus with an alert().
 */
export default function CopyRunLink({ runId }: { runId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "shown">("idle");
  const url = typeof window !== "undefined" ? `${window.location.origin}/run/${runId}` : `/run/${runId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("shown");
    }
  }

  return (
    <span className="cluster">
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => void copy()}>
        {state === "copied" ? "Copied!" : "Copy link"}
      </button>
      {state === "shown" && (
        <span className="small mono" role="status">
          {url}
        </span>
      )}
    </span>
  );
}
