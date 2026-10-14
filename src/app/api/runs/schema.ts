import { z } from "zod";
import { validateSubmission } from "@/pipeline/run";

/** Must match MAX_PEOPLE in src/app/start-form.tsx. */
export const MAX_PEOPLE = 20;

export const EntrySchema = z.object({
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

export const BodySchema = z.object({
  // 20 people = at most 40 paid captures in one request. The showcase is a
  // committed file, so this cap does not limit what can be *viewed*.
  entries: z
    .array(EntrySchema, {
      required_error: "Add at least one person.",
      invalid_type_error: "Add at least one person.",
    })
    .min(1, "Add at least one person.")
    .max(MAX_PEOPLE, `${MAX_PEOPLE} people per run is the limit.`),
  // Trust gates, not paperwork. Anyone can paste anyone's bio with any URLs,
  // so the submitter must attest consent and adulthood explicitly — the
  // honor system is stated as a fact nowhere in this product.
  consent: z.literal(true, {
    errorMap: () => ({ message: "Confirm every person in this run consented to being included." }),
  }),
  adult: z.literal(true, {
    errorMap: () => ({ message: "Confirm everyone in this run is 18 or older." }),
  }),
});

export interface PersonIssue {
  index: number;
  field: string;
  message: string;
}

/** Zod failures become the same per-person issue list the UI renders. */
export function zodIssues(error: z.ZodError): PersonIssue[] {
  const out: PersonIssue[] = [];
  for (const iss of error.issues) {
    const [, index, field] = iss.path;
    if (typeof index !== "number") continue;
    out.push({ index, field: typeof field === "string" ? field : "linkedin", message: friendlyMessage(iss) });
  }
  return out;
}

/**
 * Zod's own wording is for developers ("Expected string, received number"),
 * and it reached end users verbatim on the most common malformed-payload
 * paths. Translate the recurring ones into something actionable, and keep the
 * field name so the message still points somewhere.
 */
function friendlyMessage(iss: z.ZodIssue): string {
  const field = String(iss.path[iss.path.length - 1] ?? "this field");
  const label = field === "linkedin" ? "the LinkedIn link" : field === "instagram" ? "the Instagram link" : field;
  const raw = iss.message ?? "";

  if (/Expected string, received/.test(raw)) return `${capitalise(label)} must be text.`;
  if (/must contain at most (\d+) character/.test(raw)) {
    const max = raw.match(/must contain at most (\d+) character/)?.[1];
    return max ? `Keep ${label} under ${max} characters.` : `${capitalise(label)} is too long.`;
  }
  if (/Expected object, received/.test(raw)) return "Send a JSON object with an entries list of people.";
  if (/Expected array/.test(raw)) return "Send the people as a list under entries.";
  if (/Required|required/.test(raw)) return `Add ${label}.`;
  return raw;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Link problems from a payload that failed shape validation. Runs on whatever
 * arrived so one missing field does not hide the rest of the mistakes.
 */
export function linkIssuesFromUnknown(raw: unknown): PersonIssue[] {
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

/**
 * Parses the request body into entries, or returns the combined issue list
 * that explains why it could not be used. Shared by the create and extend
 * routes so both report the same things in the same shape.
 */
export function readEntries(raw: unknown):
  | { ok: true; entries: z.infer<typeof EntrySchema>[] }
  | { ok: false; message: string; issues: PersonIssue[] } {
  const shape = BodySchema.safeParse(raw);
  if (!shape.success) {
    // Collect shape problems AND link problems together. Returning on the
    // shape error first meant one missing field hid every other problem, so
    // the user fixed one thing, resubmitted, and only then found the next.
    const issues = [...zodIssues(shape.error), ...linkIssuesFromUnknown(raw)];
    // Whole-body errors (null, an array, a missing entries list, or an
    // unchecked attestation box) have no person index to attach to, so they
    // surface as the headline instead. Attestations come first: refusing to
    // confirm consent dwarfs any link typo.
    const bodyLevel = shape.error.issues.filter(
      (i) => Array.isArray(i.path) && i.path.length === 1 && typeof i.path[0] === "string",
    );
    const topLevel = shape.error.issues.filter((i) => !Array.isArray(i.path) || i.path.length === 0);
    const message =
      (bodyLevel.length > 0 ? friendlyMessage(bodyLevel[0]!) : undefined) ??
      (topLevel.length > 0 ? friendlyMessage(topLevel[0]!) : undefined) ??
      issues[0]?.message ??
      shape.error.issues[0]?.message ??
      "Invalid request.";
    return { ok: false, message, issues };
  }
  const issues = validateSubmission(shape.data.entries);
  if (issues.length > 0) {
    return { ok: false, message: "Some links are not usable.", issues };
  }
  return { ok: true, entries: shape.data.entries };
}
