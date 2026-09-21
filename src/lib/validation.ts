import { z } from "zod";
import { CATEGORY_VALUES } from "./types.ts";

export const LIMITS = {
  title: 120,
  description: 2000,
  improvementReason: 1000,
  name: 80,
  email: 160,
  note: 2000,
} as const;

export const MINIMUMS = {
  title: 3,
  description: 20,
  improvementReason: 10,
  name: 1,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const suggestionSchema = z.object({
    title: z
      .string()
      .min(MINIMUMS.title, `Give your idea a title of at least ${MINIMUMS.title} characters.`)
      .max(LIMITS.title, `Keep the title to ${LIMITS.title} characters or fewer.`),
    description: z
      .string()
      .min(
        MINIMUMS.description,
        `Tell us a bit more — at least ${MINIMUMS.description} characters.`,
      )
      .max(LIMITS.description, `Keep the details to ${LIMITS.description} characters or fewer.`),
    category: z.enum(CATEGORY_VALUES, { message: "Pick a category." }),
    improvementReason: z
      .string()
      .min(
        MINIMUMS.improvementReason,
        `Say how this would help — at least ${MINIMUMS.improvementReason} characters.`,
      )
      .max(
        LIMITS.improvementReason,
        `Keep this to ${LIMITS.improvementReason} characters or fewer.`,
      ),
    // Identity is required for every new submission. studentName comes from
    // the client (the only thing a student types); studentEmail is never
    // accepted from the client at all — the server fills it in from the
    // verified, signed-in Supabase session. See src/app/api/suggestions/route.ts.
    studentName: z
      .string()
      .min(MINIMUMS.name, "Enter your name.")
      .max(LIMITS.name, "That name is too long."),
    turnstileToken: z.string().optional(),
  });

export type SuggestionInput = z.infer<typeof suggestionSchema>;

export const noteSchema = z.object({
  suggestionId: z.string().regex(UUID, "Unknown suggestion."),
  body: z
    .string()
    .min(1, "Write something first.")
    .max(LIMITS.note, `Notes are limited to ${LIMITS.note} characters.`),
});

/**
 * Turn a ZodError into a flat `{ field: message }` map without relying on
 * helpers whose names differ between Zod majors.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
