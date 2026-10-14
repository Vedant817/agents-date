"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Run management: list/unlist in the gallery, and delete (the takedown
 * path). All three require the manage token returned once at creation;
 * without it the buttons explain instead of acting.
 */
export default function RunManage({ runId, listed }: { runId: string; listed: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isListed, setIsListed] = useState(listed);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setToken(window.sessionStorage.getItem(`ad-manage-${runId}`));
    }
  }, [runId]);

  function remember(value: string) {
    setToken(value || null);
    if (typeof window !== "undefined" && value) {
      window.sessionStorage.setItem(`ad-manage-${runId}`, value);
    }
  }

  async function call(url: string, init: RequestInit, okText: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((data as { error?: string }).error ?? "Something went wrong.");
        setBusy(false);
        return false;
      }
      setMessage(okText);
      setBusy(false);
      return true;
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
      setBusy(false);
      return false;
    }
  }

  async function toggleListed() {
    if (!token) {
      setMessage("Paste the manage token first — it was shown once when this run was created.");
      return;
    }
    const ok = await call(
      `/api/runs/${runId}/visibility`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listed: !isListed, manageToken: token }),
      },
      !isListed ? "Listed in the gallery." : "Unlisted. The direct link still opens.",
    );
    if (ok) {
      setIsListed(!isListed);
      router.refresh();
    }
  }

  async function remove() {
    if (!token) {
      setMessage("Paste the manage token first — it was shown once when this run was created.");
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    const ok = await call(
      `/api/runs/${runId}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manageToken: token }),
      },
      "Deleted.",
    );
    if (ok) {
      if (typeof window !== "undefined") window.sessionStorage.removeItem(`ad-manage-${runId}`);
      router.push("/runs");
    }
  }

  return (
    <details className="disclose">
      <summary>Manage this run (list, unlist, delete)</summary>
      <div className="mt8">
        <label className="field">
          <span>Manage token</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="Shown once when the run was created"
            defaultValue={token ?? ""}
            onChange={(e) => remember(e.target.value.trim())}
          />
        </label>
        <div className="cluster">
          <button className="btn btn-sm" type="button" onClick={() => void toggleListed()} disabled={busy}>
            {isListed ? "Unlist from gallery" : "List in gallery"}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => void remove()}
            disabled={busy}
          >
            {confirmingDelete ? "Confirm delete — removes everything" : "Delete this run"}
          </button>
        </div>
        {message && (
          <p className="small mt8 mb0" role="status">
            {message}
          </p>
        )}
        <p className="small dim mt8 mb0">
          Listed runs appear in the public gallery. Unlisted runs open by direct link only. Deleting removes all
          profiles, dates and rankings permanently.
        </p>
      </div>
    </details>
  );
}
