# Contributing the showcase run

The showcase (`/demo`) is a **real run built from consenting volunteers** —
never synthetic data. There is no seed script and there never will be: if
this file does not exist, `/demo` renders its empty state instead of
faking one.

## Rules for the showcase file

1. Every person in the run pasted their **own** visible profile text, or
   explicitly consented in writing to its inclusion. No public figures, no
   scraped bios, no invented people.
2. At least **25 people** (the challenge minimum), each with a LinkedIn and
   a public Instagram URL that belongs to them.
3. Generate it through the real product, not by hand:
   - Start the app (`npm run dev`), add each volunteer on the start page
     with their links + pasted text, and submit.
   - Wait for completion, open the run, and read every profile page: names
     correct, traits cited, no refuted quotes, dates read naturally.
   - Run the audit against the stored file and require PASS:
     `npx tsx scripts/audit-run.ts .data/runs/<runId>.json`
4. Copy the audited file to `data/showcase.json`:
   - Set its `id` to `"showcase"`.
   - Confirm `npm run audit` (no argument) passes on it.
   - Confirm `npm test` is green.
5. Keep the file anonymised only by consent: volunteers choose whether
   their real names appear. Whatever they choose is what ships.

## Refreshing it

Re-run this process whenever the pipeline changes analysis output
(taxonomy, negation, engine). A stale showcase that no longer matches
what the product computes is a claim the product cannot keep — regenerate
rather than explain.
