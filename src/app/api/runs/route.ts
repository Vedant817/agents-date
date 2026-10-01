import { NextResponse } from "next/server";
import { z } from "zod";
import { ConsentedTextAdapter } from "@/ingest/public";
import { buildAdapters, normaliseInstagramUrl, normaliseLinkedInUrl } from "@/ingest/setup";
import type { Run } from "@/core/types";
import {
  computeNetwork,
  emptyRun,
  hasSampleEntry,
  isSampleSubmission,
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
  linkedin: z
    .string({ required_error: "LinkedIn link is required.", invalid_type_error: "LinkedIn link must be text." })
    .min(1, "LinkedIn link is required.")
    .max(300),
  instagram: z
    .string({ required_error: "Instagram link is required.", invalid_type_error: "Instagram link must be text." })
    .min(1, "Instagram link is required.")
    .max(300),
  linkedinText: z.string().max(8000).optional(),
  instagramText: z.string().max(8000).optional(),
});

const BodySchema = z.object({
  // 20 people = at most 40 paid captures in one request. The demo (26) is a
  // prebuilt file, so this cap does not limit what can be *viewed*.
  entries: z
    .array(EntrySchema, {
      required_error: "Add at least one person.",
      invalid_type_error: "Add at least one person.",
    })
    .min(1, "Add at least one person.")
    .max(20, "20 people per run is the limit."),
});

/** Zod failures become the same per-person issue list the UI renders. */
function zodIssues(error: z.ZodError): { index: number; field: string; message: string }[] {
  const out: { index: number; field: string; message: string }[] = [];
  for (const iss of error.issues) {
    const [, index, field] = iss.path;
    if (typeof index !== "number") continue;
    out.push({ index, field: typeof field === "string" ? field : "linkedin", message: iss.message });
  }
  return out;
}

/**
 * Link problems from a payload that failed shape validation. Runs on whatever
 * arrived so one missing field does not hide the rest of the mistakes.
 */
function linkIssuesFromUnknown(raw: unknown): { index: number; field: string; message: string }[] {
  if (typeof raw !== "object" || raw === null) return [];
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const usable = entries
    .map((e) => {
      const o = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
      return {
        linkedin: typeof o.linkedin === "string" ? o.linkedin : "",
        instagram: typeof o.instagram === "string" ? o.instagram : "",
      };
    })
    // Skip people missing a link entirely; the shape error already names those,
    // and validating "" again would duplicate the message.
    .filter((e) => e.linkedin !== "" || e.instagram !== "");
  return validateSubmission(usable);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Send the run as JSON." }, { status: 415 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const shape = BodySchema.safeParse(raw);
  if (!shape.success) {
    // Collect shape problems AND link problems together. Returning on the
    // shape error first meant one missing field hid every other problem, so
    // the user fixed one thing, resubmitted, and only then found the next.
    const shapeIssues = zodIssues(shape.error);
    const linkIssues = linkIssuesFromUnknown(raw);
    const issues = [...shapeIssues, ...linkIssues];
    const message = issues[0]?.message ?? shape.error.issues[0]?.message ?? "Invalid request.";
    return NextResponse.json({ error: message, issues }, { status: 400 });
  }
  const parsed = shape.data;

  // Validate every link BEFORE any network work, so the user gets one clear
  // list of problems instead of a partial run.
  const issues = validateSubmission(parsed.entries);
  if (issues.length > 0) {
    return NextResponse.json({ error: "Some links are not usable.", issues }, { status: 400 });
  }

  // Spend protection runs AFTER validation: rejecting a malformed request
  // must not burn the shared budget, or probing the form could lock out a
  // valid submit. Only a request that can actually create a run counts.
  const limit = rateLimit(request);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many runs from this address. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const store = getStore();
  const runId = newRunId();
  const notes: string[] = [];
  // The built-in example is accepted so the guided path works, but flagged so
  // the UI can label it instead of presenting synthetic profiles as a capture.
  // Each person is flagged individually: a run that mixes example and real
  // people must still mark the example ones.
  const isSample = isSampleSubmission(parsed.entries);
  const isMixed = !isSample && hasSampleEntry(parsed.entries);
  if (isSample || isMixed) {
    notes.push(
      isSample
        ? "This run used the built-in example personas, so the profiles are illustrative sample data rather than a real capture."
        : "This run mixes the built-in example personas with real links. The people marked as example are illustrative sample data, not a real capture.",
    );
  }
  if (!process.env.APIFY_TOKEN) {
    notes.push(
      "APIFY_TOKEN is not configured, so only pasted profile text could be read. Add the token to capture public profiles automatically.",
    );
  }

  const run: Run = { ...emptyRun(runId, false, notes), isSample: isSample || isMixed };
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

// Runs are created with POST only. Answer other methods with JSON rather
// than Next's default empty 405, so API clients get a usable error.
function methodNotAllowed() {
  return NextResponse.json({ error: "Use POST to create a run." }, { status: 405 });
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
