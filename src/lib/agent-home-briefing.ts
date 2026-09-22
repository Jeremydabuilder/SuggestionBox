/**
 * Pure shape + the "stale suggestion" cutoff used by the deterministic
 * agent home briefing. No I/O, no Groq — the "use server" orchestrator
 * (agent-home-actions.ts) does the counting; this just names the fixed
 * window so the number is documented and testable in one place.
 */

export const AGENT_HOME_STALE_DAYS = 7;

export interface AgentHomeBriefing {
  unreadCount: number;
  duplicateReviewCount: number;
  openActionCount: number;
  overdueActionCount: number;
  staleSuggestionCount: number;
  mostRecentMeeting: { headline: string; createdAt: string } | null;
}
