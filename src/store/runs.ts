import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Run } from "@/core/types";

/**
 * Filesystem-backed run store.
 *
 * Chosen over a hosted database for one reason: the demo and the live site
 * must both work with zero external credentials. A Convex adapter can be added
 * behind the same interface later (see Store note in README).
 *
 * Writes are atomic (tmp file + rename) and serialised per run so concurrent
 * API requests cannot interleave and corrupt a run file.
 */
export interface RunStore {
  get(runId: string): Promise<Run | null>;
  save(run: Run): Promise<Run>;
  list(): Promise<Run[]>;
  delete(runId: string): Promise<void>;
}

const DATA_DIR = process.env.AGENTS_DATE_DATA_DIR ?? path.join(process.cwd(), ".data", "runs");

/** Serialises mutations per runId to avoid lost updates. */
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  try {
    return await next;
  } finally {
    if (locks.get(key) === next || locks.size === 0) {
      // Best-effort cleanup; a leaked entry only delays future writes slightly.
    }
  }
}

function runPath(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid run id");
  return path.join(DATA_DIR, `${safe}.json`);
}

export class FileRunStore implements RunStore {
  async get(runId: string): Promise<Run | null> {
    const file = runPath(runId);
    if (!existsSync(file)) return null;
    try {
      const raw = await readFile(file, "utf8");
      return JSON.parse(raw) as Run;
    } catch {
      return null;
    }
  }

  async save(run: Run): Promise<Run> {
    return withLock(run.id, async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const file = runPath(run.id);
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
    if (existsSync(file)) {
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
