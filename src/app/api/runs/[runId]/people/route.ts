import { NextResponse } from "next/server";
import { ConsentedTextAdapter } from "@/ingest/public";
import { buildAdapters, normaliseInstagramUrl, normaliseLinkedInUrl } from "@/ingest/setup";
import type { PersonRecord, Run } from "@/core/types";
import {
  computeNetwork,
  processPerson,
  summarise,
  hasSampleEntry,
  isSampleSubmission,
  DEMO_RUN_ID,
} from "@/pipeline/run";
import { getStore } from "@/store/runs";
import { rateLimit } from "@/api/rate-limit";
import { MAX_PEOPLE, readEntries } from "../../schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Send the new people as JSON." }, { status: 415 });
  }

  const { runId } = await context.params;

  // The demo is served from a committed file, not the store, so a normal
  // lookup would report 404 and blame the link. Answer the well-known id
  // directly instead: it exists, it is just not extendable.
  if (runId === DEMO_RUN_ID) {
    return NextResponse.json(
      { error: "The demo run is a fixed example and cannot be extended. Start your own run instead." },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = readEntries(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message, issues: parsed.issues }, { status: 400 });
  }
  const entries = parsed.entries;

  const store = getStore();

  // An early read so a bad or expired run is refused before any capture
  // spends money or time. The authoritative read happens under the lock,
  // below, because the run can change between here and there.
  let existing: Run | null;
  try {
    existing = await store.get(runId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run could not be read." },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: "That run does not exist or has expired." }, { status: 404 });
  }

  // Every stored person counts against the cap, not just the readable ones.
  // Counting only readable people let a run with many unreadable links past
  // the 20-person limit, because the unreadable ones were not counted.
  if (existing.people.length > MAX_PEOPLE) {
    // Should be unreachable; refuse loudly rather than growing the run further.
    return NextResponse.json(
      { error: `This run already has ${existing.people.length} people. Start a new run to add more.` },
      { status: 400 },
    );
  }
  const room = MAX_PEOPLE - existing.people.length;
  if (room <= 0) {
    return NextResponse.json(
      { error: `This run already has ${MAX_PEOPLE} people, which is the limit. Start a new run to add more.` },
      { status: 400 },
    );
  }
  if (entries.length > room) {
    return NextResponse.json(
      {
        error: `This run already has ${existing.people.length} ${peopleWord(existing.people.length)}, so only ${room} more can be added. Remove some people and try again.`,
      },
      { status: 400 },
    );
  }

  const limit = rateLimit(request);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many runs started from this network in the last minute. Try again in ${limit.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const adapters = buildAdapters();
  const supplied = adapters.find((a): a is ConsentedTextAdapter => a instanceof ConsentedTextAdapter);
  entries.forEach((entry) => {
    if (!supplied) return;
    if (entry.linkedinText?.trim()) supplied.supply("linkedin", normaliseLinkedInUrl(entry.linkedin), entry.linkedinText);
    if (entry.instagramText?.trim()) supplied.supply("instagram", normaliseInstagramUrl(entry.instagram), entry.instagramText);
  });

  // Capture outside the lock: this is the slow part, and holding the lock
  // across it would serialise every other writer on this run for nothing.
  const added: PersonRecord[] = [];
  for (const [i, entry] of entries.entries()) {
    added.push(
      await processPerson(
        runId,
        { linkedin: entry.linkedin, instagram: entry.instagram, name: entry.name },
        adapters,
        // Placeholder id; the real one is assigned under the lock, where the
        // authoritative people count is known. Two concurrent extends would
        // otherwise both mint p4/p5/p6 and one batch would be lost.
        `tmp_${i + 1}`,
      ),
    );
  }

  // Merge under the run's lock, re-reading the run, so a concurrent extend
  // cannot be clobbered and both callers cannot be told 200 while one person
  // silently disappears.
  let saved: Run | null = null;
  let conflict: string | null = null;
  let addedCount = 0;
  try {
    const result = await store.update(runId, (fresh) => {
      // Re-check the cap against the fresh copy.
      if (fresh.people.length + added.length > MAX_PEOPLE) {
        conflict = `This run already has ${fresh.people.length} ${peopleWord(fresh.people.length)}, so these people no longer fit. Try again.`;
        return null;
      }
      // Re-check duplicates against the fresh copy. Doing this only before the
      // capture let a case-variant or a concurrent upload through.
      const known = new Set<string>([
        ...fresh.people.map((p) => p.linkedinUrl.toLowerCase()),
        ...fresh.people.map((p) => p.instagramUrl.toLowerCase()),
      ]);
      for (const person of added) {
        if (known.has(person.linkedinUrl.toLowerCase()) || known.has(person.instagramUrl.toLowerCase())) {
          conflict =
            conflict ??
            `${person.displayName ?? "One of these people"} is already in this run, so nothing new would be added.`;
          return null;
        }
      }

      // Continue the run's numbering from the authoritative count.
      const firstIndex = fresh.people.length + 1;
      const numbered = added.map((person, i) => ({ ...person, id: `p${firstIndex + i}` }));
      addedCount = numbered.length;

      // Recompute across everyone so the existing profiles gain the new
      // candidates in their rankings and the new dates on their pages.
      const recomputed = computeNetwork([...fresh.people, ...numbered]);
      const notes = new Set([...(fresh.notes ?? [])]);
      const ready = numbered.filter((p) => p.status === "ready").length;
      if (numbered.length > 0) {
        notes.add(
          `Extended with ${ready} more ${ready === 1 ? "person" : "people"}${
            numbered.length - ready > 0 ? ` (${numbered.length - ready} could not be read)` : ""
          }.`,
        );
      }

      // Recompute the sample flags from the whole run. Spreading the old value
      // kept "Example run" on the page after real people were added, and kept
      // the mixed-run notice off when example people were added to a real one.
      const allEntries = recomputed.map((p) => ({ linkedin: p.linkedinUrl, instagram: p.instagramUrl }));
      const stillSample = isSampleSubmission(allEntries);
      const nowMixed = !stillSample && hasSampleEntry(allEntries);
      if (stillSample) {
        notes.add(
          "This run used the built-in example personas, so the profiles are illustrative sample data rather than a real capture.",
        );
      } else if (nowMixed) {
        notes.add(
          "This run mixes the built-in example personas with real links. The people marked as example are illustrative sample data, not a real capture.",
        );
      }
      if (!process.env.APIFY_TOKEN) {
        notes.add(
          "APIFY_TOKEN is not configured, so only pasted profile text could be read. Add the token to capture public profiles automatically.",
        );
      }

      return {
        ...fresh,
        people: recomputed,
        isSample: stillSample,
        notes: [...notes],
        status: recomputed.some((p) => p.status === "ready") ? "complete" : fresh.status,
      };
    });
    saved = result;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run could not be read." },
      { status: 500 },
    );
  }

  if (conflict || !saved) {
    return NextResponse.json({ error: conflict ?? "That run does not exist or has expired." }, { status: 400 });
  }

  return NextResponse.json({ runId: saved.id, summary: summarise(saved), added: addedCount }, { status: 200 });
}

function peopleWord(n: number): string {
  return n === 1 ? "person" : "people";
}

// Runs are extended with POST only. Answer other methods with JSON next to
// the precedent set by /api/runs, rather than Next's bodyless 405.
function methodNotAllowed() {
  return NextResponse.json({ error: "Use POST to add people to a run." }, { status: 405 });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
