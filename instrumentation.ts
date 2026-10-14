/**
 * Runs once when the server boots, before traffic arrives.
 *
 * A restart kills the in-memory background jobs, so any run left `running`
 * would otherwise lie forever. The sweep marks them failed with an
 * explanatory note, keeping whatever people had already been read.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { sweepOrphanedRuns } = await import("./src/pipeline/background");
    const { FileRunStore } = await import("./src/store/runs");
    await sweepOrphanedRuns().catch(() => undefined);
    await new FileRunStore().reapTmpFiles().catch(() => undefined);
  }
}
