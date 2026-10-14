import Link from "next/link";

/**
 * The default Next 404 is an unstyled page with no navigation, so a mistyped
 * link or an expired run dumped the visitor outside the site entirely. This
 * keeps the frame, says which case they are in, and offers the two routes
 * that always work.
 */
export default function NotFound() {
  return (
    <main>
      <div className="page-head">
        <p className="eyebrow">404</p>
        <h1>This page does not exist.</h1>
      </div>
      <p className="lede">
        The link may be mistyped, or it may point at a run that expired when the server restarted. Start pages,
        the gallery and the showcase below all still work.
      </p>

      <div className="panel">
        <h2>Where to go instead</h2>
        <ul className="clean">
          <li>
            <b>Start a run.</b> Paste a LinkedIn and a public Instagram for each person, and the pipeline runs end to
            end: analysis, dating, rankings.
          </li>
          <li>
            <b>Open the showcase.</b> A finished run with analysed profiles, recorded agent dates and every shortlist
            ranked.
          </li>
          <li>
            <b>Read the method.</b> What is measured from each profile, and what is deliberately not claimed.
          </li>
        </ul>
      </div>

      <div className="cluster">
        <Link className="btn btn-primary" href="/">
          Add profiles
        </Link>
        <Link className="btn" href="/demo">
          Open the showcase
        </Link>
        <Link className="btn btn-ghost" href="/method">
          How it works
        </Link>
      </div>
    </main>
  );
}
