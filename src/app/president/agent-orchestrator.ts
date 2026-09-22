import "server-only";
import type { PresidentSession } from "@/lib/auth";
import { getPresidentSession } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { routeDeterministically } from "@/lib/chat-router-deterministic";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import { boundTextForPrompt } from "@/lib/text-bounds";
import { generateClassifierCompletion, generateAnswerCompletion } from "@/lib/groq";
import { allCitationsAllowed } from "@/lib/inbox-citations";
import {
  AGENT_PLAN_LIMITS,
  AGENT_STEP_LABELS,
  agentPlanResponseSchema,
  sanitizePlanSteps,
  type AgentEvidenceItem,
  type AgentPlan,
  type AgentStepStatus,
  type PlannableIntent,
} from "@/lib/agent-plan";
import { matchAgentPlanTemplate, looksLikeCompoundGoal } from "@/lib/agent-plan-templates";
import { AGENT_PLAN_SYSTEM_PROMPT, buildAgentPlanUserPrompt, AGENT_PLAN_LIMITS as PLAN_PROMPT_LIMITS } from "@/lib/agent-plan-prompt";
import { AGENT_SYNTHESIS_SYSTEM_PROMPT, buildAgentSynthesisPrompt, AGENT_SYNTHESIS_LIMITS } from "@/lib/agent-synthesis-prompt";
import { deriveSuggestedNextAction } from "@/lib/agent-next-action";
import { searchInbox } from "./inbox-search-actions";
import { getTrendRadar } from "./trend-radar-actions";
import { getPromiseTracker } from "./promise-tracker-actions";
import { listDecisions } from "./decisions-actions";
import { listActionItems } from "./action-items-actions";
import { getSinceLastMeetingReport } from "./since-last-meeting-actions";
import { listMeetingBriefs } from "./workspace-actions";

/**
 * The bounded, server-controlled multi-step agent orchestrator. Not a
 * Server Action and never calls getPresidentSession() for its OWN first
 * check — same boundary as chat-router.ts: the caller
 * (chat-orchestration-actions.ts) must obtain and pass in an
 * already-verified session. This module does re-check the session
 * before EVERY step it executes (see the loop below), which is the
 * literal "revalidate session and authorization for every tool"
 * requirement, even though in this single request they all share one
 * verified cookie read.
 *
 * Every tool this can call is one of AGENT_PLANNABLE_INTENTS
 * (lib/agent-plan.ts) — a hard-coded, mutation-free subset of the
 * existing tool registry. Nothing here can write to any table: it only
 * calls the same pre-existing, already-tested read-only server actions
 * every single-intent chat turn already uses.
 */

interface StepExecution {
  status: AgentStepStatus;
  summary: string;
  citationRefs: string[];
  refTitles: Record<string, string>;
}

function failedStep(error: string): StepExecution {
  return { status: "failed", summary: error, citationRefs: [], refTitles: {} };
}

async function executeStep(intent: PlannableIntent, args: Record<string, unknown>): Promise<StepExecution> {
  switch (intent) {
    case "search_inbox": {
      const a = args as { query?: string; category?: string; status?: string };
      const result = await searchInbox(a.query, a.category, a.status);
      if (!result.ok) return failedStep(result.error);
      const { hits, totalMatches } = result.data;
      const top = hits.slice(0, 5);
      const summary =
        totalMatches === 0
          ? "No matching suggestions found."
          : `${totalMatches} matching suggestion${totalMatches === 1 ? "" : "s"}. ${top.map((h) => `[${h.ref}] ${h.title}`).join("; ")}`;
      return {
        status: "done",
        summary,
        citationRefs: hits.map((h) => h.ref),
        refTitles: Object.fromEntries(hits.map((h) => [h.ref, h.title])),
      };
    }
    case "trend_radar": {
      const result = await getTrendRadar();
      if (!result.ok) return failedStep(result.error);
      const rising = result.data.trends.filter((t) => t.isRising);
      const summary =
        rising.length === 0
          ? "No category is trending up right now."
          : `${rising.length} rising categor${rising.length === 1 ? "y" : "ies"}: ${rising.map((t) => t.category).join(", ")}.`;
      return { status: "done", summary, citationRefs: [], refTitles: {} };
    }
    case "promise_tracker": {
      const result = await getPromiseTracker();
      if (!result.ok) return failedStep(result.error);
      const { gaps } = result.data;
      const summary =
        gaps.length === 0
          ? "No decisions are missing a recorded follow-up action."
          : `${gaps.length} decision${gaps.length === 1 ? "" : "s"} still missing a recorded follow-up action.`;
      return { status: "done", summary, citationRefs: [], refTitles: {} };
    }
    case "list_decisions": {
      const result = await listDecisions();
      if (!result.ok) return failedStep(result.error);
      const summary = result.data.length === 0 ? "No decisions logged yet." : `${result.data.length} decision${result.data.length === 1 ? "" : "s"} logged.`;
      return { status: "done", summary, citationRefs: [], refTitles: {} };
    }
    case "list_actions": {
      const result = await listActionItems();
      if (!result.ok) return failedStep(result.error);
      const open = result.data.filter((a) => !a.completed);
      const now = Date.now();
      const overdue = open.filter((a) => a.deadline && new Date(a.deadline).getTime() < now);
      const summary = `${open.length} open action item${open.length === 1 ? "" : "s"}${overdue.length > 0 ? `, ${overdue.length} overdue` : ""}.`;
      return { status: "done", summary, citationRefs: [], refTitles: {} };
    }
    case "since_last_meeting": {
      const a = args as { meetingId?: string };
      const result = await getSinceLastMeetingReport(a.meetingId);
      if (!result.ok) return failedStep(result.error);
      return { status: "done", summary: result.data.summary, citationRefs: [], refTitles: {} };
    }
    case "meeting_history": {
      const result = await listMeetingBriefs(false);
      if (!result.ok) return failedStep(result.error);
      const summary = result.data.length === 0 ? "No saved meetings yet." : `${result.data.length} saved meeting${result.data.length === 1 ? "" : "s"}.`;
      return { status: "done", summary, citationRefs: [], refTitles: {} };
    }
    case "meeting_prep": {
      // No Groq call and no data read here — same as the existing
      // single-intent behavior, this only signals the panel is ready.
      // The brief itself is only generated later, inside that panel,
      // only if the president clicks Generate there.
      return { status: "done", summary: "Meeting Prep is ready to open.", citationRefs: [], refTitles: {} };
    }
  }
}

export interface AgentPlanStepView {
  step: number;
  intent: PlannableIntent;
  label: string;
  status: AgentStepStatus;
}

export interface AgentTurnResult {
  planSource: "template" | "ai";
  plan: AgentPlanStepView[];
  evidence: AgentEvidenceItem[];
  synthesizedAnswer: string | null;
  citations: Array<{ ref: string; title: string }>;
  suggestedNextAction: string | null;
  openPanel: "meeting_prep" | null;
  groqRequestCount: number;
}

const AGENT_PLAN_MIN_AI_STEPS = 2;

/**
 * Returns null when this message should NOT become a multi-step agent
 * turn at all — the caller then falls through to the existing,
 * completely unmodified single-intent routeChatMessage path. This is
 * intentionally conservative: a deterministic template match, or (only
 * when nothing else fits) exactly one bounded planning call, are the
 * only two ways a plan is ever produced.
 */
async function resolvePlan(session: PresidentSession, message: string): Promise<{ plan: AgentPlan | null; groqRequestCount: number }> {
  const templatePlan = matchAgentPlanTemplate(message);
  if (templatePlan) return { plan: templatePlan, groqRequestCount: 0 };

  // A message the existing deterministic single-tool router already
  // confidently understands is never re-interpreted as a compound goal —
  // preserves 100% of existing single-intent chat behavior untouched.
  if (routeDeterministically(message) !== null) return { plan: null, groqRequestCount: 0 };
  if (!looksLikeCompoundGoal(message)) return { plan: null, groqRequestCount: 0 };
  if (!serverEnv.groqApiKey) return { plan: null, groqRequestCount: 0 };

  const limit = checkChatRateLimit(`chat:agent-plan:${session.email}`, 10, 5 * 60_000);
  if (!limit.allowed) return { plan: null, groqRequestCount: 0 };

  const outcome = await generateClassifierCompletion(AGENT_PLAN_SYSTEM_PROMPT, buildAgentPlanUserPrompt(message), {
    maxTokens: PLAN_PROMPT_LIMITS.maxTokens,
    timeoutMs: PLAN_PROMPT_LIMITS.timeoutMs,
  });
  if (!outcome.ok) return { plan: null, groqRequestCount: outcome.requestCount };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(outcome.content);
  } catch {
    return { plan: null, groqRequestCount: outcome.requestCount };
  }

  const shapeResult = agentPlanResponseSchema.safeParse(parsedJson);
  if (!shapeResult.success) return { plan: null, groqRequestCount: outcome.requestCount };

  const steps = sanitizePlanSteps(shapeResult.data.steps);
  if (steps.length < AGENT_PLAN_MIN_AI_STEPS) return { plan: null, groqRequestCount: outcome.requestCount };

  return {
    plan: { steps, needsSynthesis: shapeResult.data.needsSynthesis, source: "ai" },
    groqRequestCount: outcome.requestCount,
  };
}

export async function runAgentTurn(session: PresidentSession, rawMessage: string): Promise<AgentTurnResult | null> {
  const message = boundTextForPrompt(rawMessage, PLAN_PROMPT_LIMITS.message);
  if (!message) return null;

  const { plan, groqRequestCount: planningRequestCount } = await resolvePlan(session, message);
  if (!plan) return null;

  const evidence: AgentEvidenceItem[] = [];
  const planView: AgentPlanStepView[] = [];
  const refTitleByRef = new Map<string, string>();
  let consecutiveFailures = 0;
  let planIncludesMeetingPrep = false;
  let hasRisingTrend = false;
  let promiseGapCount = 0;
  let overdueActionCount = 0;

  for (const [index, step] of plan.steps.slice(0, AGENT_PLAN_LIMITS.maxSteps).entries()) {
    // Revalidate session and authorization for every step — if it has
    // expired mid-turn, stop safely rather than run the remaining steps
    // as nobody.
    const stepSession = await getPresidentSession();
    if (!stepSession) break;

    const result = await executeStep(step.intent, step.args);
    for (const [ref, title] of Object.entries(result.refTitles)) refTitleByRef.set(ref, title);

    evidence.push({ intent: step.intent, label: AGENT_STEP_LABELS[step.intent], status: result.status, summary: result.summary, citationRefs: result.citationRefs });
    planView.push({ step: index + 1, intent: step.intent, label: AGENT_STEP_LABELS[step.intent], status: result.status });

    if (step.intent === "meeting_prep" && result.status === "done") planIncludesMeetingPrep = true;
    if (step.intent === "trend_radar" && result.status === "done" && /rising categor/i.test(result.summary)) hasRisingTrend = true;
    if (step.intent === "promise_tracker" && result.status === "done") {
      const match = result.summary.match(/^(\d+) decision/);
      if (match) promiseGapCount = Number(match[1]);
    }
    if (step.intent === "list_actions" && result.status === "done") {
      const match = result.summary.match(/(\d+) overdue/);
      if (match) overdueActionCount = Number(match[1]);
    }

    if (result.status === "failed") {
      consecutiveFailures += 1;
      if (consecutiveFailures >= AGENT_PLAN_LIMITS.maxConsecutiveFailures) break;
    } else {
      consecutiveFailures = 0;
    }
  }

  let synthesizedAnswer: string | null = null;
  let citations: Array<{ ref: string; title: string }> = [];
  let synthesisRequestCount = 0;

  const hasUsableEvidence = evidence.some((e) => e.status === "done");
  if (plan.needsSynthesis && hasUsableEvidence && serverEnv.groqApiKey) {
    const limit = checkChatRateLimit(`chat:agent-synthesis:${session.email}`, 10, 5 * 60_000);
    if (limit.allowed) {
      const userPrompt = buildAgentSynthesisPrompt(
        message,
        evidence.filter((e) => e.status === "done").map((e) => ({ label: e.label, summary: e.summary })),
      );
      const outcome = await generateAnswerCompletion(AGENT_SYNTHESIS_SYSTEM_PROMPT, userPrompt, {
        maxTokens: AGENT_SYNTHESIS_LIMITS.maxTokens,
        timeoutMs: AGENT_SYNTHESIS_LIMITS.timeoutMs,
      });
      synthesisRequestCount = outcome.requestCount;

      if (outcome.ok) {
        const allowedRefs = new Set(refTitleByRef.keys());
        if (allCitationsAllowed(outcome.content, allowedRefs)) {
          synthesizedAnswer = outcome.content.trim();
          const citedRefs = [...allowedRefs].filter((ref) => outcome.content.includes(`[${ref}]`));
          citations = citedRefs.map((ref) => ({ ref, title: refTitleByRef.get(ref) ?? "" }));
        } else {
          console.error("[agent-orchestrator] discarded a synthesis citing a ref outside its own evidence");
        }
      }
    }
  }

  const suggestedNextAction = deriveSuggestedNextAction({
    plannedIntents: plan.steps.map((s) => s.intent),
    hasRisingTrend,
    promiseGapCount,
    overdueActionCount,
  });

  return {
    planSource: plan.source,
    plan: planView,
    evidence,
    synthesizedAnswer,
    citations,
    suggestedNextAction,
    openPanel: planIncludesMeetingPrep ? "meeting_prep" : null,
    groqRequestCount: planningRequestCount + synthesisRequestCount,
  };
}
