import { z } from "zod";

export const CHAT_LIMITS = {
  title: 200,
  userMessage: 4000,
  memoryText: 500,
} as const;

export const MEMORY_CATEGORIES = ["meeting_format", "terminology", "tone", "constraint", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const conversationTitleSchema = z
  .string()
  .trim()
  .min(1, "Give the conversation a title.")
  .max(CHAT_LIMITS.title, `Keep the title to ${CHAT_LIMITS.title} characters or fewer.`);

export const userMessageContentSchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(CHAT_LIMITS.userMessage, `Keep messages to ${CHAT_LIMITS.userMessage} characters or fewer.`);

/* ------------------------------------------------------------------ */
/* Structured assistant content — what a chat_messages.structured JSON */
/* value is allowed to look like. Nothing outside this union may ever  */
/* be trusted or rendered as more than plain text.                     */
/* ------------------------------------------------------------------ */

export const memoryProposalStructuredSchema = z.object({
  type: z.literal("memory_proposal"),
  confirmationId: z.string().uuid(),
  operation: z.enum(["create", "update", "delete"]),
  memoryText: z.string().min(1).max(CHAT_LIMITS.memoryText),
  category: z.enum(MEMORY_CATEGORIES).nullable(),
});
export type MemoryProposalStructured = z.infer<typeof memoryProposalStructuredSchema>;

export const statusStructuredSchema = z.object({
  type: z.literal("status"),
  status: z.enum(["confirmed", "cancelled", "expired", "error"]),
  message: z.string().min(1).max(300),
});
export type StatusStructured = z.infer<typeof statusStructuredSchema>;

/**
 * The inline "Since Last Meeting" report card (Stage 6). Every field is a
 * bounded count or a capped list of already-public workspace facts
 * (suggestion titles/status, decision/action text) — nothing here is
 * student PII beyond what the dashboard itself already shows, and nothing
 * here is a citation to content the president can't otherwise see.
 */
export const sinceLastMeetingReportStructuredSchema = z.object({
  type: z.literal("since_last_meeting_report"),
  referenceMeetingHeadline: z.string().nullable(),
  newSuggestionCount: z.number().int().min(0),
  newSuggestions: z
    .array(z.object({ id: z.string().uuid(), title: z.string().max(300), status: z.string() }))
    .max(20),
  statusChangeCount: z.number().int().min(0),
  statusChanges: z
    .array(
      z.object({
        suggestionId: z.string().uuid(),
        title: z.string().max(300),
        fromStatus: z.string().nullable(),
        toStatus: z.string(),
      }),
    )
    .max(20),
  newDecisionCount: z.number().int().min(0),
  newDecisions: z.array(z.object({ id: z.string().uuid(), decisionText: z.string().max(2000) })).max(20),
  newActionCount: z.number().int().min(0),
  newActions: z.array(z.object({ id: z.string().uuid(), actionText: z.string().max(2000) })).max(20),
  overdueActionCount: z.number().int().min(0),
  dueSoonActionCount: z.number().int().min(0),
  needsAttention: z.array(z.string().max(200)).max(10),
});
export type SinceLastMeetingReportStructured = z.infer<typeof sinceLastMeetingReportStructuredSchema>;

const suggestionRefSchema = z.string().regex(/^S\d{3}$/);

/** Stage 7: "Search the inbox" — a capped, deterministic keyword/filter result, never a Groq call. */
export const inboxSearchResultsStructuredSchema = z.object({
  type: z.literal("inbox_search_results"),
  totalMatches: z.number().int().min(0),
  hits: z
    .array(z.object({ ref: suggestionRefSchema, title: z.string().max(300), status: z.string(), category: z.string() }))
    .max(15),
});
export type InboxSearchResultsStructured = z.infer<typeof inboxSearchResultsStructuredSchema>;

/**
 * Stage 7: "Ask the Inbox". `citations` is always the post-validation
 * allowlisted subset (see chat-inbox-answer.ts) — a ref the model cited
 * that wasn't in its own evidence never reaches this schema, because the
 * whole answer is discarded before a structured value is ever built.
 */
export const inboxAnswerStructuredSchema = z.object({
  type: z.literal("inbox_answer"),
  answer: z.string().max(1000),
  citations: z.array(z.object({ ref: suggestionRefSchema, title: z.string().max(300) })).max(8),
});
export type InboxAnswerStructured = z.infer<typeof inboxAnswerStructuredSchema>;

/** Stage 7: Trend Radar — deterministic category-frequency comparison, never a Groq call. */
export const trendRadarStructuredSchema = z.object({
  type: z.literal("trend_radar_report"),
  trends: z
    .array(
      z.object({
        category: z.string(),
        recentCount: z.number().int().min(0),
        priorCount: z.number().int().min(0),
        olderCount: z.number().int().min(0),
        changeRatio: z.number().nullable(),
        label: z.enum(["emerging", "sustained", "cooling", "insufficient_evidence"]),
        confidence: z.enum(["low", "moderate", "high"]),
        isRising: z.boolean(),
      }),
    )
    .max(10),
});
export type TrendRadarStructured = z.infer<typeof trendRadarStructuredSchema>;

/** Stage 7: Promise Tracker — deterministic decision-without-follow-up-action gaps, never a Groq call. */
export const promiseTrackerStructuredSchema = z.object({
  type: z.literal("promise_tracker_report"),
  gaps: z
    .array(
      z.object({
        id: z.string().uuid(),
        decisionText: z.string().max(2000),
        meetingHeadline: z.string().nullable(),
        daysSinceDecision: z.number().int().min(0),
      }),
    )
    .max(20),
  meetingScopedDecisionCount: z.number().int().min(0),
  suggestionGaps: z.array(z.object({ id: z.string().uuid(), title: z.string().max(300), daysSinceCreated: z.number().int().min(0) })).max(20),
  staleActionGaps: z.array(z.object({ id: z.string().uuid(), actionText: z.string().max(2000), daysSinceCreated: z.number().int().min(0) })).max(20),
});
export type PromiseTrackerStructured = z.infer<typeof promiseTrackerStructuredSchema>;

/**
 * Stage 8: Proposal Builder. Deliberately has no cost, budget, or policy
 * field anywhere in this shape — the strongest version of "never invent a
 * dollar figure or a policy citation" is a schema with nowhere to put
 * one. `citations` is always the post-validation allowlisted subset (see
 * chat-proposal-builder.ts), same guarantee as inbox_answer.
 */
export const proposalDraftStructuredSchema = z.object({
  type: z.literal("proposal_draft"),
  answer: z.string().max(3000),
  citations: z.array(z.object({ ref: suggestionRefSchema, title: z.string().max(300) })).max(10),
});
export type ProposalDraftStructured = z.infer<typeof proposalDraftStructuredSchema>;

/** Stage 8: draft communications. Nothing in this codebase can send this — it is chat text only, same as every other reply. */
export const communicationDraftStructuredSchema = z.object({
  type: z.literal("communication_draft"),
  kind: z.enum([
    "assembly_announcement",
    "student_update",
    "status_explanation",
    "teacher_admin_request",
    "follow_up_question",
    "meeting_recap",
  ]),
  answer: z.string().max(3000),
  citations: z.array(z.object({ ref: suggestionRefSchema, title: z.string().max(300) })).max(8),
});
export type CommunicationDraftStructured = z.infer<typeof communicationDraftStructuredSchema>;

/**
 * Stage 10 UX audit fix: meeting_history, list_decisions, and list_actions
 * used to always open a full modal on a chat message — a read-only answer
 * that should appear inline, per the product requirement that the AI
 * Workspace feel like one chat, not tabs hidden behind panels. These three
 * schemas carry a small, capped summary read inline; the full,
 * already-existing modal (MeetingHistory/DecisionLog/ActionItems) is still
 * one click away via the card's "Open full view" button, or the header's
 * quick-access buttons — never removed, just no longer the default for a
 * plain read.
 */
export const meetingHistorySummaryStructuredSchema = z.object({
  type: z.literal("meeting_history_summary"),
  totalCount: z.number().int().min(0),
  items: z.array(z.object({ id: z.string().uuid(), headline: z.string().max(300), state: z.string(), createdAt: z.string() })).max(10),
});
export type MeetingHistorySummaryStructured = z.infer<typeof meetingHistorySummaryStructuredSchema>;

export const decisionsSummaryStructuredSchema = z.object({
  type: z.literal("decisions_summary"),
  totalCount: z.number().int().min(0),
  items: z.array(z.object({ id: z.string().uuid(), decisionText: z.string().max(2000), createdAt: z.string() })).max(10),
});
export type DecisionsSummaryStructured = z.infer<typeof decisionsSummaryStructuredSchema>;

export const actionsSummaryStructuredSchema = z.object({
  type: z.literal("actions_summary"),
  totalCount: z.number().int().min(0),
  items: z
    .array(z.object({ id: z.string().uuid(), actionText: z.string().max(2000), completed: z.boolean(), deadline: z.string().nullable() }))
    .max(10),
});
export type ActionsSummaryStructured = z.infer<typeof actionsSummaryStructuredSchema>;

/**
 * Co-President Agent: a completed (or partially completed) multi-step
 * plan. `plan` and `evidence` are always the REAL steps that ran, in the
 * order they ran, each with its actual status — never a fabricated
 * "success" for a step that failed or was skipped. `synthesizedAnswer`
 * and `citations` are null/empty whenever no synthesis call was needed
 * or its citations failed the allowlist check (agent-orchestrator.ts
 * never lets a partially-trusted synthesis through). `suggestedNextAction`
 * is always a fixed, deterministically-chosen string — see
 * lib/agent-next-action.ts — never something the model wrote.
 */
const agentPlanStepStructuredSchema = z.object({
  step: z.number().int().min(1),
  intent: z.string(),
  label: z.string().max(80),
  status: z.enum(["done", "failed", "skipped"]),
});

const agentEvidenceItemStructuredSchema = z.object({
  intent: z.string(),
  label: z.string().max(80),
  status: z.enum(["done", "failed", "skipped"]),
  summary: z.string().max(600),
  citationRefs: z.array(suggestionRefSchema).max(10),
});

export const agentTurnStructuredSchema = z.object({
  type: z.literal("agent_turn"),
  planSource: z.enum(["template", "ai"]),
  plan: z.array(agentPlanStepStructuredSchema).max(4),
  evidence: z.array(agentEvidenceItemStructuredSchema).max(4),
  synthesizedAnswer: z.string().max(1000).nullable(),
  citations: z.array(z.object({ ref: suggestionRefSchema, title: z.string().max(300) })).max(10),
  suggestedNextAction: z.string().max(200).nullable(),
  openPanel: z.enum(["meeting_prep"]).nullable(),
});
export type AgentTurnStructured = z.infer<typeof agentTurnStructuredSchema>;

export const assistantStructuredSchema = z.discriminatedUnion("type", [
  memoryProposalStructuredSchema,
  statusStructuredSchema,
  sinceLastMeetingReportStructuredSchema,
  inboxSearchResultsStructuredSchema,
  inboxAnswerStructuredSchema,
  trendRadarStructuredSchema,
  promiseTrackerStructuredSchema,
  proposalDraftStructuredSchema,
  communicationDraftStructuredSchema,
  meetingHistorySummaryStructuredSchema,
  decisionsSummaryStructuredSchema,
  actionsSummaryStructuredSchema,
  agentTurnStructuredSchema,
]);
export type AssistantStructured = z.infer<typeof assistantStructuredSchema>;

/* ------------------------------------------------------------------ */
/* Pending-confirmation payload schemas — must match exactly what      */
/* public.apply_chat_memory_confirmation() reads out of `payload`.     */
/* ------------------------------------------------------------------ */

export const saveMemoryPayloadSchema = z.object({
  memoryText: z.string().trim().min(1).max(CHAT_LIMITS.memoryText),
  category: z.enum(MEMORY_CATEGORIES).nullable().optional(),
});
export type SaveMemoryPayload = z.infer<typeof saveMemoryPayloadSchema>;

export const updateMemoryPayloadSchema = z.object({
  memoryId: z.string().uuid(),
  memoryText: z.string().trim().min(1).max(CHAT_LIMITS.memoryText).optional(),
  category: z.enum(MEMORY_CATEGORIES).nullable().optional(),
  expectedUpdatedAt: z.string().min(1),
});
export type UpdateMemoryPayload = z.infer<typeof updateMemoryPayloadSchema>;

export const deleteMemoryPayloadSchema = z.object({
  memoryId: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
});
export type DeleteMemoryPayload = z.infer<typeof deleteMemoryPayloadSchema>;

/* ------------------------------------------------------------------ */
/* Row / application types                                             */
/* ------------------------------------------------------------------ */

export interface ChatConversation {
  id: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  structured: AssistantStructured | null;
  createdBy: string;
  createdAt: string;
}

export type PendingConfirmationStatus = "pending" | "confirmed" | "expired" | "invalidated";

export interface Memory {
  id: string;
  memoryText: string;
  category: MemoryCategory | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}
