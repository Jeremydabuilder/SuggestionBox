import { z } from "zod";
import { CATEGORY_VALUES, STATUS_VALUES } from "./types.ts";

/**
 * The complete, closed set of things the chat agent may ever be routed to.
 * Nothing outside this list can be a "route" — there is no escape hatch for
 * a model-invented capability, a table name, a URL, or a tool name. Adding
 * a new capability means adding a new enum value AND a new schema here,
 * deliberately, not something a prompt can talk its way into.
 */
export const CHAT_INTENTS = [
  "help",
  "search_inbox",
  "suggestion_details",
  "related_suggestions",
  "since_last_meeting",
  "meeting_prep",
  "meeting_history",
  "trash",
  "list_decisions",
  "list_actions",
  "proposal_builder",
  "trend_radar",
  "promise_tracker",
  "draft_communication",
  "meeting_cleanup",
  "memory_manager",
  "general_workspace_question",
  "clarification_needed",
] as const;

export type ChatIntent = (typeof CHAT_INTENTS)[number];

export const chatIntentSchema = z.enum(CHAT_INTENTS);

export const CONFIDENCE_CATEGORIES = ["high", "medium", "low"] as const;
export type ConfidenceCategory = (typeof CONFIDENCE_CATEGORIES)[number];

const SUGGESTION_REF = /^S\d{3}$/;
const shortText = (max: number) => z.string().trim().min(1).max(max);

/**
 * One strict, unknown-keys-rejected schema per intent. `general_
 * workspace_question` and `clarification_needed` are the only intents
 * that carry free text (a question, or a clarification prompt) — every
 * other intent's arguments are bounded enums, S### refs, uuids, or short
 * bounded strings. None of these schemas can carry SQL, a URL, a table
 * name, a server-action name, or an authorization claim: there is no
 * field for any of that anywhere below.
 */
export const intentArgSchemas = {
  help: z.object({}).strict(),

  search_inbox: z
    .object({
      query: z.string().trim().max(200).optional(),
      category: z.enum(CATEGORY_VALUES).optional(),
      status: z.enum(STATUS_VALUES).optional(),
    })
    .strict(),

  suggestion_details: z
    .object({
      ref: z.string().regex(SUGGESTION_REF).optional(),
      query: z.string().trim().max(200).optional(),
    })
    .strict()
    .refine((v) => Boolean(v.ref || v.query), "Name a suggestion by reference or a short description."),

  related_suggestions: z
    .object({
      ref: z.string().regex(SUGGESTION_REF),
    })
    .strict(),

  since_last_meeting: z
    .object({
      meetingId: z.string().uuid().optional(),
      // Raw bounded phrase only ("last week", "our last meeting") — actual
      // date resolution is deliberately NOT attempted here or by the model;
      // that is a later stage's deterministic job.
      datePhrase: z.string().trim().max(50).optional(),
    })
    .strict(),

  meeting_prep: z
    .object({
      scope: z.enum(["new", "active", "all"]).optional(),
    })
    .strict(),

  meeting_history: z
    .object({
      filter: z.enum(["all", "archived"]).optional(),
    })
    .strict(),

  // Read-only: the agent can only ever tell the caller to open the Trash
  // panel, the same way meeting_history/list_decisions/list_actions do.
  // It has no argument that could name a suggestion to move, restore, or
  // delete — see chat-tool-registry.ts's executeRoute for why that's true
  // for every step after this one too.
  trash: z.object({}).strict(),

  list_decisions: z
    .object({
      query: z.string().trim().max(200).optional(),
      meetingId: z.string().uuid().optional(),
    })
    .strict(),

  list_actions: z
    .object({
      status: z.enum(["open", "completed", "overdue", "due_soon"]).optional(),
      meetingId: z.string().uuid().optional(),
    })
    .strict(),

  proposal_builder: z
    .object({
      topic: z.string().trim().max(200).optional(),
    })
    .strict(),

  trend_radar: z.object({}).strict(),

  promise_tracker: z.object({}).strict(),

  draft_communication: z
    .object({
      kind: z
        .enum([
          "assembly_announcement",
          "student_update",
          "status_explanation",
          "teacher_admin_request",
          "follow_up_question",
          "meeting_recap",
        ])
        .optional(),
      topic: z.string().trim().max(200).optional(),
    })
    .strict(),

  meeting_cleanup: z
    .object({
      // A reference to a transcript the president already has open —
      // never the transcript content itself.
      transcriptRef: z.string().trim().max(100).optional(),
    })
    .strict(),

  memory_manager: z
    .object({
      action: z.enum(["list", "search"]).optional(),
      query: z.string().trim().max(200).optional(),
    })
    .strict(),

  general_workspace_question: z
    .object({
      query: shortText(500),
    })
    .strict(),

  clarification_needed: z
    .object({
      question: shortText(300),
    })
    .strict(),
} as const satisfies { [K in ChatIntent]: z.ZodType };

export type IntentArgs<I extends ChatIntent> = z.infer<(typeof intentArgSchemas)[I]>;

/**
 * The single shape every route — deterministic or AI-classified — must
 * end up as. `args` is always validated against the specific schema for
 * `intent` before a RouteDecision is ever constructed; there is no path
 * that skips this.
 */
export interface RouteDecision {
  intent: ChatIntent;
  args: Record<string, unknown>;
  confidence: ConfidenceCategory;
  needsClarification: boolean;
  clarificationQuestion?: string;
  source: "deterministic" | "ai" | "fallback";
}

/** Validates `args` against intent's own schema. Throws on any mismatch — callers must not swallow this. */
export function parseIntentArgs<I extends ChatIntent>(intent: I, args: unknown): IntentArgs<I> {
  const schema = intentArgSchemas[intent];
  return schema.parse(args) as IntentArgs<I>;
}

/**
 * Runtime-safe even when `intent` didn't actually come through the
 * TypeScript enum (e.g. parsed from JSON, or a model response before its
 * own shape has been checked) — an intent name outside the allowlist
 * fails closed here instead of throwing.
 */
export function safeParseIntentArgs(intent: ChatIntent, args: unknown) {
  const schema = intentArgSchemas[intent];
  if (!schema) return z.object({}).strict().safeParse({ __unknown_intent__: intent });
  return schema.safeParse(args);
}
