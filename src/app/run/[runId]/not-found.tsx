import Link from "next/link";

/**
 * A run id that is not in the store. Two very different causes need
 * different advice: the id was mistyped, or the run was real and has been
 * lost because user runs live on an ephemeral filesystem. Saying only "not
 * found" left the second case looking like the first.
 */
export default function RunNotFound() {
  return (
    <main>
      <div className="page-head">
        <p className="eyebrow">Run not found</p>
        <h1>No run with that id on this server.</h1>
      </div>
      <p className="lede">Check the link, or start one of your own. Nothing you submitted was ranked against anyone else.</p>

      <div className="notice notice-info">
        <b>If the run really existed, it has probably expired.</b> User runs are stored on temporary disk, so they can
        be lost when the server restarts or the site is redeployed. The committed{" "}
        <Link href="/demo">showcase run</Link> does not expire, because it is read from the repository.
      </div>

      <div className="cluster">
        <Link className="btn btn-primary" href="/">
          Add profiles
        </Link>
        <Link className="btn" href="/demo">
          Open the showcase
        </Link>
      </div>
    </main>
  );
}
