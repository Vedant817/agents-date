import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Run } from "@/core/types";

/**
 * Filesystem-backed run store.
 *
 * Chosen over a hosted database for one reason: the demo and the live site must
 * both work with zero external credentials. A hosted adapter can be added
 * behind the same interface later.
 *
 * DEPLOYMENT CAVEAT: on most PaaS hosts (Render, Heroku, Fly) the container
 * filesystem is ephemeral, so user-created runs are lost on restart or
 * redeploy. The committed demo run is unaffected because it is read from the
 * repository. `isEphemeral` is surfaced on the run page so the UI can tell the
 * user their run is temporary instead of silently losing it.
 *
 * Writes are atomic (tmp file + rename) and serialised per run so concurrent
 * API requests cannot interleave and corrupt a run file.
 */
export interface RunStore {
  get(runId: string): Promise<Run | null>;
  save(run: Run): Promise<Run>;
  list(): Promise<Run[]>;
  delete(runId: string): Promise<void>;
  /** True when writes do not survive a restart. */
  isEphemeral(): boolean;
}

const DATA_DIR = process.env.AGENTS_DATE_DATA_DIR ?? path.join(process.cwd(), ".data", "runs");

/** Serialises mutations per runId to avoid lost updates. */
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => undefined);
  locks.set(key, settled);
  try {
    return await next;
  } finally {
    // Prune so the map cannot grow without bound over a long-lived process.
    if (locks.get(key) === settled) locks.delete(key);
  }
}

function runPath(runId: string): string | null {
  // Reject, do not collapse. Stripping disallowed characters made "a.b" and
  // "ab" alias to the same file while taking different locks, so one writer's
  // run was silently lost. Returning null keeps lookup total and safe.
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) return null;
  return path.join(DATA_DIR, `${runId}.json`);
}

/** Render and similar hosts set RENDER=1 and mount the filesystem as ephemeral. */
function detectEphemeral(): boolean {
  if (process.env.AGENTS_DATE_EPHEMERAL) return process.env.AGENTS_DATE_EPHEMERAL === "1";
  return Boolean(process.env.RENDER || process.env.FLY_APP_NAME || process.env.HEROKU_APP_NAME);
}

export class FileRunStore implements RunStore {
  isEphemeral(): boolean {
    return detectEphemeral();
  }

  async get(runId: string): Promise<Run | null> {
    const file = runPath(runId);
    if (!file || !existsSync(file)) return null;
    try {
      const raw = await readFile(file, "utf8");
      return JSON.parse(raw) as Run;
    } catch (error) {
      // Distinguish "unreadable file" from "does not exist". Swallowing this
      // made a corrupt run look like an expired one (404 "does not exist"),
      // hiding real data loss.
      const err = new Error(
        `Run ${runId} exists but could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      (err as Error & { code?: string }).code = "RUN_CORRUPT";
      throw err;
    }
  }

  async save(run: Run): Promise<Run> {
    const file = runPath(run.id);
    if (!file) throw new Error(`Invalid run id: ${run.id}`);
    // Lock on the same key used for the file, so two ids that map to one file
    // can never take different locks.
    return withLock(run.id, async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      const payload: Run = { ...run, updatedAt: Date.now() };
      await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
      const { rename } = await import("node:fs/promises");
      await rename(tmp, file);
      return payload;
    });
  }

  async list(): Promise<Run[]> {
    if (!existsSync(DATA_DIR)) return [];
    const files = await readdir(DATA_DIR);
    const runs: Run[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(DATA_DIR, f), "utf8");
        runs.push(JSON.parse(raw) as Run);
      } catch {
        // A corrupt file should not hide every other run.
      }
    }
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(runId: string): Promise<void> {
    const file = runPath(runId);
    if (file && existsSync(file)) {
      const { unlink } = await import("node:fs/promises");
      await unlink(file);
    }
  }
}

let storeInstance: RunStore | null = null;

export function getStore(): RunStore {
  if (!storeInstance) storeInstance = new FileRunStore();
  return storeInstance;
}
