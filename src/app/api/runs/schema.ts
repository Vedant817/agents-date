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
  // 20 people = at most 40 paid captures in one request. The demo is a
  // prebuilt file, so this cap does not limit what can be *viewed*.
  entries: z
    .array(EntrySchema, {
      required_error: "Add at least one person.",
      invalid_type_error: "Add at least one person.",
    })
    .min(1, "Add at least one person.")
    .max(MAX_PEOPLE, `${MAX_PEOPLE} people per run is the limit.`),
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
    out.push({ index, field: typeof field === "string" ? field : "linkedin", message: iss.message });
  }
  return out;
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
    const message = issues[0]?.message ?? shape.error.issues[0]?.message ?? "Invalid request.";
    return { ok: false, message, issues };
  }
  const issues = validateSubmission(shape.data.entries);
  if (issues.length > 0) {
    return { ok: false, message: "Some links are not usable.", issues };
  }
  return { ok: true, entries: shape.data.entries };
}
