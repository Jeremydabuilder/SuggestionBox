import { z } from "zod";
import { chatIntentSchema, safeParseIntentArgs, type ChatIntent } from "./chat-intents.ts";

/**
 * The closed set of tools a multi-step agent plan may ever contain. This
 * is a hard-coded SUBSET of CHAT_INTENTS, independent of anything a model
 * says: every one of these is "read_only" or "draft" in the tool
 * registry (chat-tool-registry.ts) — never "confirmation_required". No
 * plan step can mutate anything, propose a memory change, or touch
 * chat_pending_confirmations, which is what makes "the agent cannot
 * confirm its own proposal" true by construction rather than by
 * instruction: there is no confirmation-capable intent in this list for
 * a plan to name in the first place.
 */
export const AGENT_PLANNABLE_INTENTS = [
  "search_inbox",
  "trend_radar",
  "promise_tracker",
  "list_decisions",
  "list_actions",
  "since_last_meeting",
  "meeting_history",
  "meeting_prep",
] as const;
/**
 * Deliberately excludes general_workspace_question and proposal_builder:
 * both make their OWN Groq call when run as a single-intent tool
 * (chat-inbox-answer.ts / chat-proposal-builder.ts). Letting either run
 * as a plan step would make step execution itself variably expensive and
 * could blow past the documented per-turn Groq ceiling. Every intent
 * above is zero-Groq when executed — the entire step-execution phase of
 * an agent turn never calls Groq at all; only planning (if no template
 * matches) and the final synthesis (if the plan needs one) ever do, each
 * independently bounded to at most 2 requests. meeting_prep costs
 * nothing as a plan step, same as its existing single-intent behavior —
 * it only signals the Meeting Prep panel is ready; the Groq call that
 * actually drafts a brief happens later, only if the president clicks
 * Generate there.
 */

export type PlannableIntent = (typeof AGENT_PLANNABLE_INTENTS)[number];

export function isPlannableIntent(intent: string): intent is PlannableIntent {
  return (AGENT_PLANNABLE_INTENTS as readonly string[]).includes(intent);
}

/**
 * Fixed, human-written status text per tool — never model-authored. This
 * is what "show only concise task/status information, never hidden
 * chain-of-thought" means structurally: the model (when a planning call
 * is used at all) only ever picks an intent from the closed list above,
 * and the UI label for that intent always comes from this lookup table,
 * never from anything the model wrote.
 */
export const AGENT_STEP_LABELS: Record<PlannableIntent, string> = {
  search_inbox: "Searching recent suggestions",
  trend_radar: "Comparing related ideas",
  promise_tracker: "Checking open actions",
  list_decisions: "Reviewing decisions",
  list_actions: "Checking action items",
  since_last_meeting: "Checking what changed since your last meeting",
  meeting_history: "Reviewing meeting history",
  meeting_prep: "Building the meeting brief",
};

export const AGENT_PLAN_LIMITS = {
  maxSteps: 4,
  maxConsecutiveFailures: 2,
} as const;

export interface AgentPlanStep {
  intent: PlannableIntent;
  args: Record<string, unknown>;
}

export interface AgentPlan {
  steps: AgentPlanStep[];
  /** Whether the combined evidence needs one prose synthesis call, or is clear enough to show as-is. */
  needsSynthesis: boolean;
  /** Where this plan came from — logged in metadata, never the plan's own text. */
  source: "template" | "ai";
}

/**
 * Caps at AGENT_PLAN_LIMITS.maxSteps and drops any repeated intent
 * (keeping the first occurrence) — a plan can never ask the same tool
 * twice, which is also the first line of defense against a
 * planning-loop. Every surviving step's args are re-validated against
 * that intent's OWN strict schema (safeParseIntentArgs, the same
 * function chat-router.ts already uses) — a step that fails validation
 * is dropped, never passed through with defaulted/guessed args.
 */
export function sanitizePlanSteps(rawSteps: Array<{ intent: unknown; args: unknown }>): AgentPlanStep[] {
  const seen = new Set<PlannableIntent>();
  const steps: AgentPlanStep[] = [];

  for (const raw of rawSteps) {
    if (steps.length >= AGENT_PLAN_LIMITS.maxSteps) break;

    const intentResult = chatIntentSchema.safeParse(raw.intent);
    if (!intentResult.success) continue;
    const intent = intentResult.data;
    if (!isPlannableIntent(intent)) continue;
    if (seen.has(intent)) continue;

    const argsResult = safeParseIntentArgs(intent, raw.args ?? {});
    if (!argsResult.success) continue;

    seen.add(intent);
    steps.push({ intent, args: argsResult.data as Record<string, unknown> });
  }

  return steps;
}

/** The bounded JSON shape a single planning Groq call is allowed to return — nothing outside AGENT_PLANNABLE_INTENTS can ever parse. */
export const agentPlanResponseSchema = z.object({
  steps: z
    .array(
      z.object({
        intent: z.enum(AGENT_PLANNABLE_INTENTS),
        args: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(AGENT_PLAN_LIMITS.maxSteps),
  needsSynthesis: z.boolean().default(true),
});

export type AgentStepStatus = "done" | "failed" | "skipped";

export interface AgentEvidenceItem {
  intent: ChatIntent;
  label: string;
  status: AgentStepStatus;
  /** A short, already-bounded, deterministic summary — never raw model prose about what happened. */
  summary: string;
  citationRefs: string[];
}
