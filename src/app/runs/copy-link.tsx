"use client";

/**
 * Copies a run's share link. Falls back to showing the URL when the
 * clipboard API is unavailable, so the link is never trapped.
 */
export default function CopyRunLink({ runId }: { runId: string }) {
  async function copy() {
    const url = `${window.location.origin}/run/${runId}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`Copied: ${url}`);
    } catch {
      alert(`Copy this link: ${url}`);
    }
  }
  return (
    <button className="btn btn-sm btn-ghost" type="button" onClick={() => void copy()}>
      Copy link
    </button>
  );
}
