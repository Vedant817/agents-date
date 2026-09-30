import { NextResponse } from "next/server";
import { z } from "zod";
import { ConsentedTextAdapter } from "@/ingest/public";
import { buildAdapters, normaliseInstagramUrl, normaliseLinkedInUrl } from "@/ingest/setup";
import type { Run } from "@/core/types";
import {
  computeNetwork,
  emptyRun,
  newRunId,
  processPerson,
  summarise,
  validateSubmission,
} from "@/pipeline/run";
import { getStore } from "@/store/runs";
import { rateLimit } from "@/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EntrySchema = z.object({
  name: z.string().max(120).optional(),
  linkedin: z.string().min(1, "LinkedIn link is required").max(300),
  instagram: z.string().min(1, "Instagram link is required").max(300),
  linkedinText: z.string().max(8000).optional(),
  instagramText: z.string().max(8000).optional(),
});

const BodySchema = z.object({
  // 20 people = at most 40 paid captures in one request. The demo (26) is a
  // prebuilt file, so this cap does not limit what can be *viewed*.
  entries: z.array(EntrySchema).min(1, "Add at least one person.").max(20, "20 people per run is the limit."),
});

export async function POST(request: Request) {
  // Bound the damage a single request can do. Each person costs up to two
  // Apify captures, so an unauthenticated 30-person POST is 60 paid calls.
  const limit = rateLimit(request);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many runs from this address. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    const raw = await request.json();
    parsed = BodySchema.parse(raw);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? "Invalid request."
        : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Validate every link BEFORE any network work, so the user gets one clear
  // list of problems instead of a partial run.
  const issues = validateSubmission(parsed.entries);
  if (issues.length > 0) {
    return NextResponse.json({ error: "Some links are not usable.", issues }, { status: 400 });
  }

  const store = getStore();
  const runId = newRunId();
  const notes: string[] = [];
  if (!process.env.APIFY_TOKEN) {
    notes.push(
      "APIFY_TOKEN is not configured, so only pasted profile text could be read. Add the token to capture public profiles automatically.",
    );
  }

  const run = emptyRun(runId, false, notes);
  run.status = "running";
  await store.save(run);

  const adapters = buildAdapters();
  const supplied = adapters.find((a): a is ConsentedTextAdapter => a instanceof ConsentedTextAdapter);
  parsed.entries.forEach((entry) => {
    if (!supplied) return;
    if (entry.linkedinText?.trim()) supplied.supply("linkedin", normaliseLinkedInUrl(entry.linkedin), entry.linkedinText);
    if (entry.instagramText?.trim()) supplied.supply("instagram", normaliseInstagramUrl(entry.instagram), entry.instagramText);
  });

  const people = [];
  for (const [i, entry] of parsed.entries.entries()) {
    const person = await processPerson(
      runId,
      { linkedin: entry.linkedin, instagram: entry.instagram, name: entry.name },
      adapters,
      `p${i + 1}`,
    );
    people.push(person);
  }

  const computed = computeNetwork(people);
  const finalRun: Run = {
    ...run,
    people: computed,
    status: computed.some((p) => p.status === "ready") ? "complete" : "failed",
  };
  const saved = await store.save(finalRun);

  return NextResponse.json({ runId: saved.id, summary: summarise(saved) }, { status: 201 });
}
