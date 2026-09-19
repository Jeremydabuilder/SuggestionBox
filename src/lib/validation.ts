import { z } from "zod";
import { CATEGORY_VALUES } from "./types";

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
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    isAnonymous: z.boolean(),
    studentName: z.string().max(LIMITS.name, "That name is too long.").optional(),
    studentEmail: z
      .string()
      .max(LIMITS.email, "That email address is too long.")
      .refine((v) => v === "" || emailPattern.test(v), "That doesn't look like an email address.")
      .optional(),
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
