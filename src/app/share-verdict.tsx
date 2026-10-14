"use client";

import { useState } from "react";
import { trailerFor } from "@/dating/engine";
import type { DateSession } from "@/core/types";

/**
 * Copies a social verdict card for a finished date: names, score, verdict,
 * best line, and the link. Clipboard with a show-the-text fallback, like the
 * run copy button — the output is social, not archival.
 */
export default function ShareVerdict({
  session,
  aName,
  bName,
  url,
}: {
  session: DateSession;
  aName: string;
  bName: string;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const trailer = trailerFor(session);
  if (!trailer) return null;

  const card =
    `${aName} × ${bName} — fit ${trailer.overall.toFixed(2)} · ${trailer.verdict}\n` +
    (trailer.bestLine ? `Best line: "${trailer.bestLine}"\n` : "") +
    (trailer.tension ? `Tension: "${trailer.tension}"\n` : "") +
    `Watch it: ${url}\nSimulated conversation — no person said any of this.`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(card);
      setCopied(true);
    } catch {
      // No alert(): dumping the card into a dialog steals focus and
      // interrupts screen readers. The button label says where to find it.
      setCopied(false);
      setShowFallback(true);
    }
  }

  return (
    <span className="cluster">
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => void copy()}>
        {copied ? "Copied!" : "Share verdict"}
      </button>
      {showFallback && !copied && (
        <span className="small" role="status">
          Copy unavailable — select the verdict text above.
        </span>
      )}
    </span>
  );
}
