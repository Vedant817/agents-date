# Challenge submission

## Links

| | |
|---|---|
| Live app | https://agents-date.onrender.com |
| Showcase (real consented run) | https://agents-date.onrender.com/demo |
| How it works / limits | https://agents-date.onrender.com/method |
| Instant date | https://agents-date.onrender.com/date |
| Repository | https://github.com/Vedant817/agents-date |
| Video | STALE (`artifacts/agents-date-demo.mp4` shows the retired synthetic demo) — recapture against the real showcase run once volunteers contribute, per `data/SHOWCASE.md` - not yet published to YouTube |

## Short description (167 characters)

```
Each agent reads two public profiles, cites every claim to a source line, then dates another agent and ranks who fits. No LLM, nothing hidden. agents-date.onrender.com
```

## Technical section

**Stack.** Next.js 15.5.26 (App Router) on React 19, TypeScript in strict mode with
`noUncheckedIndexedAccess`, Zod for validation, Vitest for tests, and the ffmpeg
toolchain for the submission video. Deployed on Render. No LLM anywhere in the
pipeline: analysis, dating and ranking are deterministic functions, so the same
input always produces the same transcript.

**Pipeline.** Each person is captured from two sources, LinkedIn and Instagram.
Extraction maps source lines onto a canonical trait taxonomy, and every trait
keeps the exact quote plus `personId`, `source` and line number that justified
it. Agents then hold a multi-turn date using only traits that a citation
supports, and ranking scores each directed pair on five weighted components
drawn from the two profiles. Nothing is sent to a real person: the transcripts
are labelled AI simulations in the UI.

**Evidence integrity is enforced, not asserted.** `npm run audit <run-file>`
re-derives the current data and fails on twelve properties, including citations
that do not resolve to a real source line, one-sided claims cited to the wrong
side, traits with no evidence, a trait refuted by its own quote, a misleading
"adds something new", a wrong session `runId`, and a leaked placeholder name.
The negation check shares its predicate with the matcher
(`src/core/negation.ts`), so a refuted quote can neither ship nor pass the
audit. There is no synthetic data in the repo: the audit runs against real
stored runs, or against the committed showcase run once volunteers contribute
it (see `data/SHOWCASE.md`).

**Defects found by adversarial QA and fixed, each with a regression test.**
Clause-scoped negation, so "I hate running" no longer yields "into running";
gerund disambiguation, so a beekeeper "running 14 hives" is not reported as
into running; a fixed "everything they show is something you already have"
string that was false for 144 of 650 pairs; dating turns that refuted their own
citation; unreadable people silently entering rankings; forged
`x-forwarded-for` headers that reset the rate limit; pasted profile text
rendered with the authority of a live capture (every source now carries
`readMode: live | pasted`, labelled in the UI); "Add more people"
discarding the run it came from (runs extend in place, with concurrent extends
merged under a per-run lock); case-variant duplicates rated as separate people;
an undocumented date count (each agent dates its first choice; mutual choices
share one date); and unbranded 404s that dropped visitors outside the site.

**Trust is structural, not copy.** Every submission requires explicit consent +
18+ attestations; pasted text is screened for school-age cues (educator guard
included) with visible exclusion; runs are unlisted by default behind a
manage token (returned once, stored hashed) that gates extending, listing and
deleting; transcripts speak as agents under a persistent simulated-conversation
banner; the gallery shows opt-in runs only.

**Honest limits, stated in the app itself.** LinkedIn returns HTTP 999 to
automated readers, so that capture path is disabled by default under the site
terms. Instagram serves a client-only page and its JSON endpoint returns 401, so
real Instagram capture needs an `APIFY_TOKEN` and is opt-in. Without a token the
app still runs end to end on pasted public profile text, and failed captures
stay visible rather than being faked. The showcase (`/demo`, committed at
`data/showcase.json`) is a real run built from consenting volunteers through
the same pipeline and the same audit as a live run — see `data/SHOWCASE.md`
for the contribution rules. Until volunteers contribute, `/demo` renders its
empty state instead of faking one. Runs are stored on an ephemeral filesystem
and can be lost on redeploy.