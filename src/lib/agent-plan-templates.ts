import type { AgentPlan } from "./agent-plan.ts";

/**
 * Zero-Groq multi-step plan recognition, the same spirit as
 * chat-router-deterministic.ts: a small number of fairly specific
 * phrasings, matched conservatively, so ordinary single-tool messages
 * are never mistaken for a compound goal. Returns null — never a guess —
 * when nothing here confidently matches, which is what tells the caller
 * to fall back to the existing single-intent router untouched, or (only
 * if the message also looks like a compound goal) the bounded one-call
 * AI planner.
 */

export function matchAgentPlanTemplate(rawMessage: string): AgentPlan | null {
  const message = rawMessage.trim();
  if (!message) return null;

  // "Prepare us for Friday's meeting and focus on lunch" / "prepare for the
  // meeting, focus on recycling" / "prepare our next meeting about clubs"
  const meetingFocus = message.match(/\bprepare\b.*\bmeeting\b.*\b(?:focus(?:ing|ed)? on|about|regarding)\s+(.+)/i);
  if (meetingFocus) {
    const topic = meetingFocus[1]!.trim().replace(/[.?!]+$/, "").slice(0, 200);
    if (topic) {
      return {
        source: "template",
        needsSynthesis: false,
        steps: [
          { intent: "search_inbox", args: { query: topic } },
          { intent: "trend_radar", args: {} },
          { intent: "promise_tracker", args: {} },
          { intent: "meeting_prep", args: {} },
        ],
      };
    }
  }

  // "What's the biggest student concern?" / "find the biggest concern" /
  // "what's the biggest issue right now"
  if (/\b(biggest|top|most (common|pressing))\b.*\b(concern|issue|problem|complaint)\b/i.test(message)) {
    return {
      source: "template",
      needsSynthesis: true,
      steps: [
        { intent: "trend_radar", args: {} },
        { intent: "search_inbox", args: {} },
        { intent: "promise_tracker", args: {} },
      ],
    };
  }

  return null;
}

/**
 * A conservative, deliberately narrow signal for "this message probably
 * describes more than one thing to do" — joins two of this app's own
 * domain nouns with "and"/"then". This gates the ONE allowed AI planning
 * call (see agent-orchestrator.ts): a message that doesn't look
 * compound never spends a planning request at all, even if the
 * deterministic templates above also missed it.
 */
const DOMAIN_TERMS =
  /\b(meeting|agenda|decisions?|actions?|suggestions?|inbox|proposal|trend|duplicate|follow[- ]?up|concern|update|announcement)\b/gi;

export function looksLikeCompoundGoal(rawMessage: string): boolean {
  const message = rawMessage.trim();
  if (!/\b(and|then)\b/i.test(message)) return false;
  const matches = message.match(DOMAIN_TERMS);
  return (matches?.length ?? 0) >= 2;
}
