import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Run } from "@/core/types";

/**
 * Filesystem-backed run store.
 *
 * Chosen over a hosted database for one reason: the showcase and the live site
 * must both work with zero external credentials. A hosted adapter can be added
 * behind the same interface later.
 *
 * DEPLOYMENT CAVEAT: on most PaaS hosts (Render, Heroku, Fly) the container
 * filesystem is ephemeral, so user-created runs are lost on restart or
 * redeploy. The committed showcase run is unaffected because it is read from the
 * repository. `isEphemeral` is surfaced on the run page so the UI can tell the
 * user their run is temporary instead of silently losing it.
 *
 * Writes are atomic (tmp file + rename) and serialised per run so concurrent
 * API requests cannot interleave and corrupt a run file.
 */
export interface RunStore {
  get(runId: string): Promise<Run | null>;
  save(run: Run): Promise<Run>;
  /**
   * Read-modify-write under the run's own lock. `save` alone only serialises
   * writes, so a handler that reads, does slow work elsewhere, then saves can
   * still clobber another writer's changes — which is exactly what the extend
   * endpoint did, silently dropping a person while both requests said 200.
   */
  update(runId: string, fn: (run: Run) => Run | null): Promise<Run | null>;
  /**
   * Newest first. With a limit, pre-trims by filename (run ids are
   * time-ordered) so callers that show a page never parse the whole store.
   */
  list(limit?: number): Promise<Run[]>;
  /** File count without parsing: O(1) reads for health checks and badges. */
  count(): Promise<number>;
  /** Removes orphaned tmp files. Runs at boot via instrumentation. */
  reapTmpFiles(): Promise<number>;
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
    return withLock(run.id, () => this.write(file, run));
  }

  async update(runId: string, fn: (run: Run) => Run | null): Promise<Run | null> {
    // Hold the lock across the read AND the write, so a concurrent writer
    // cannot interleave. The capture work happens outside this call, so a slow
    // network request never blocks another run's write.
    return withLock(runId, async () => {
      let run: Run | null;
      try {
        run = await this.get(runId);
      } catch {
        // A corrupt run stays corrupt rather than being silently overwritten.
        throw new Error(`Run ${runId} exists but could not be read.`);
      }
      if (!run) return null;
      const next = fn(run);
      if (!next) return run;
      const file = runPath(runId);
      if (!file) throw new Error(`Invalid run id: ${runId}`);
      // Must NOT go through save(): the lock is not reentrant, and taking it
      // again from inside here would deadlock this call against itself.
      return this.write(file, next);
    });
  }

  /** The actual write. The caller is responsible for holding the run's lock. */
  private async write(file: string, run: Run): Promise<Run> {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const payload: Run = { ...run, updatedAt: Date.now() };
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    const { rename, unlink } = await import("node:fs/promises");
    // On Windows the rename can fail with EPERM when a scanner (antivirus,
    // indexer) briefly holds the just-written tmp file. Retry a few times
    // before giving up, or a healthy save looks like a product defect.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rename(tmp, file);
        return payload;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
    // Best effort: do not leave the tmp file behind for list() to trip over.
    await unlink(tmp).catch(() => undefined);
    throw lastError;
  }

  async list(limit?: number): Promise<Run[]> {
    if (!existsSync(DATA_DIR)) return [];
    let files = await readdir(DATA_DIR);
    files = files.filter((f) => f.endsWith(".json"));
    if (limit !== undefined) {
      // Pre-trim by filename before parsing: run ids start with a base-36
      // timestamp, so lexicographic order is newest-first and a gallery
      // query never parses thousands of files to show 30. Parsing the
      // whole store per page hit made /runs take 17s locally.
      files = files.sort().reverse().slice(0, Math.max(0, limit));
    }
    const runs: Run[] = [];
    for (const f of files) {
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

  /**
   * Removes orphaned tmp files left by kills between write and rename.
   * Readers ignore non-.json files, so these are pure litter — but unbounded
   * litter on a long-lived process. Runs at boot, never per request.
   */
  async reapTmpFiles(): Promise<number> {
    if (!existsSync(DATA_DIR)) return 0;
    const { unlink } = await import("node:fs/promises");
    const files = await readdir(DATA_DIR);
    let reaped = 0;
    for (const f of files) {
      if (!f.endsWith(".tmp")) continue;
      await unlink(path.join(DATA_DIR, f)).catch(() => undefined);
      reaped += 1;
    }
    return reaped;
  }

  async count(): Promise<number> {
    if (!existsSync(DATA_DIR)) return 0;
    const files = await readdir(DATA_DIR);
    let n = 0;
    for (const f of files) if (f.endsWith(".json")) n += 1;
    return n;
  }
}

let storeInstance: RunStore | null = null;

export function getStore(): RunStore {
  if (!storeInstance) storeInstance = new FileRunStore();
  return storeInstance;
}
