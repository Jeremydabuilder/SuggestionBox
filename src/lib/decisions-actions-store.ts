import { z } from "zod";
import type { Suggestion } from "./types.ts";

const DECISION_TEXT_LIMITS = { min: 1, max: 2000 };
const ACTION_TEXT_LIMITS = { min: 1, max: 2000 };
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const decisionInputSchema = z.object({
  decisionText: z.string().trim().min(DECISION_TEXT_LIMITS.min, "Write the decision first.").max(DECISION_TEXT_LIMITS.max),
  meetingId: z.string().uuid().nullable(),
  citedSuggestionIds: z.array(z.string().uuid()).max(50),
});
export type DecisionInput = z.infer<typeof decisionInputSchema>;

export const updateDecisionInputSchema = decisionInputSchema.extend({ id: z.string().uuid() });
export type UpdateDecisionInput = z.infer<typeof updateDecisionInputSchema>;

export const actionItemInputSchema = z.object({
  actionText: z.string().trim().min(ACTION_TEXT_LIMITS.min, "Write the action first.").max(ACTION_TEXT_LIMITS.max),
  // Date-only string (YYYY-MM-DD) or null — never a timestamp, and never an owner.
  deadline: z.string().regex(DATE_ONLY, "Use a valid date.").nullable(),
  meetingId: z.string().uuid().nullable(),
  citedSuggestionIds: z.array(z.string().uuid()).max(50),
});
export type ActionItemInput = z.infer<typeof actionItemInputSchema>;

export const updateActionItemInputSchema = actionItemInputSchema.extend({ id: z.string().uuid() });
export type UpdateActionItemInput = z.infer<typeof updateActionItemInputSchema>;

export interface CitedSuggestion {
  id: string;
  title: string;
  status: Suggestion["status"];
}

export interface Decision {
  id: string;
  decisionText: string;
  meetingId: string | null;
  meetingHeadline: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  citations: CitedSuggestion[];
}

export interface ActionItem {
  id: string;
  actionText: string;
  deadline: string | null;
  completed: boolean;
  completedAt: string | null;
  meetingId: string | null;
  meetingHeadline: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  citations: CitedSuggestion[];
}

/**
 * The one place a decision/action citation is trusted. `requestedIds` is
 * whatever the client asked to cite; `existingSuggestionIds` must come from
 * a fresh, RLS-scoped database read (see the *-actions.ts server actions),
 * never from the client. Duplicates collapse to their first occurrence, and
 * anything not present in `existingSuggestionIds` — fabricated, deleted, or
 * otherwise inaccessible — is dropped rather than saved.
 */
export function resolveSuggestionCitations(
  requestedIds: string[],
  existingSuggestionIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const id of requestedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (existingSuggestionIds.has(id)) resolved.push(id);
  }
  return resolved;
}

export type DeadlineStatus = "none" | "overdue" | "due_soon" | "later";

/**
 * Pure classification so both the UI filters and any future test can agree
 * on what "overdue" and "due soon" mean. Due soon is the next 7 days,
 * inclusive of today; overdue is strictly before today. Uses date-only
 * comparison (no timezone-of-day drift) since deadlines are date-only.
 */
export function classifyDeadline(deadline: string | null, now = new Date()): DeadlineStatus {
  if (!deadline) return "none";
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const due = new Date(`${deadline}T00:00:00.000Z`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 7) return "due_soon";
  return "later";
}
