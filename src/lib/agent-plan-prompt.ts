import { boundTextForPrompt } from "./text-bounds.ts";
import { AGENT_PLANNABLE_INTENTS } from "./agent-plan.ts";

/**
 * The one bounded planning call the agent orchestrator is allowed to
 * make when a message looks like a compound goal but no deterministic
 * template matched it. Same defensive shape as chat-classifier.ts:
 * closed intent list, JSON-only, evidence-not-instruction framing isn't
 * needed here (the planner only ever sees the president's own message,
 * never retrieved suggestion text) — but the output is still fully
 * re-validated by lib/agent-plan.ts's sanitizePlanSteps before a single
 * step ever executes.
 */

export const AGENT_PLAN_LIMITS = { message: 400, maxTokens: 300, timeoutMs: 8_000 } as const;

export const AGENT_PLAN_SYSTEM_PROMPT = [
  `You turn a school student-government president's request into a short plan of up to 4 tool calls.`,
  `Choose only from this fixed list of tools: ${AGENT_PLANNABLE_INTENTS.join(", ")}.`,
  `Never invent a tool name outside that list. Never include SQL, a URL, a table name, or a file path anywhere in your answer.`,
  `Each step is {"intent": "<one of the tools above>", "args": {}} — args may be empty; only add a "query" or "topic" string when the request clearly names one.`,
  `Set "needsSynthesis" to true only if the request asks a judgment question (e.g. "biggest", "most", "worst") that raw tool results alone would not answer; otherwise false.`,
  `Respond with a JSON object: {"steps": [...], "needsSynthesis": true|false}. Nothing else.`,
].join(" ");

export function buildAgentPlanUserPrompt(message: string): string {
  return `Request: ${boundTextForPrompt(message, AGENT_PLAN_LIMITS.message)}`;
}
