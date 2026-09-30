# Challenge submission

## Links

| | |
|---|---|
| Live app | https://agents-date.onrender.com |
| Prebuilt demo | https://agents-date.onrender.com/demo |
| How it works / limits | https://agents-date.onrender.com/method |
| Repository | https://github.com/Vedant817/agents-date |
| Video | `artifacts/agents-date-demo.mp4` (69s, 1600x900, H.264) - not yet published to YouTube |

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

**Evidence integrity is enforced, not asserted.** `npm run audit` re-derives the
current data and fails on nine properties, including citations that do not
resolve to a real source line, one-sided claims cited to the wrong side,
traits with no evidence, a trait refuted by its own quote, a misleading "adds
something new", a wrong session `runId`, and a leaked placeholder name. On the
seeded run: 325 citations, 0 unresolved, 0 refuted, 650 additive claims with 0
false, 7 of 325 exact symmetric ranking ties (2.2%).

**Defects found by adversarial QA and fixed, each with a regression test.**
Clause-scoped negation, so "I hate running" no longer yields "into running";
gerund disambiguation, so a beekeeper "running 14 hives" is not reported as
into running; a fixed "everything they show is something you already have"
string that was false for 144 of 650 pairs; dating turns that refuted their own
citation; unreadable people silently entering rankings; and forged
`x-forwarded-for` headers that reset the rate limit.

**Honest limits, stated in the app itself.** LinkedIn returns HTTP 999 to
automated readers, so that capture path is disabled by default under the site
terms. Instagram serves a client-only page and its JSON endpoint returns 401, so
real Instagram capture needs an `APIFY_TOKEN` and is opt-in. Without a token the
app still runs end to end on pasted public profile text, and failed captures
stay visible rather than being faked. The demo run ships 26 clearly-labelled
synthetic personas, not 25 real people, because capturing real profiles would
need both authorisation and a paid scraping credential. The demo uses the same
pipeline and the same audit as a live run; only the source text differs. Runs
are stored on an ephemeral filesystem and can be lost on redeploy.