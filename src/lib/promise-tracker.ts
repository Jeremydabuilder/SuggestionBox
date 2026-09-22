/**
 * Pure, deterministic decision -> action follow-up gap detection. The
 * only structural link available between a decision and a follow-up
 * action is the shared `meetingId` both tables optionally carry — there
 * is no decision_id/action_id relationship in the schema — so this can
 * only flag a meeting-scoped decision with zero action items recorded
 * against that same meeting. A standalone decision (no meetingId) is
 * outside what this can check and is never flagged; that is an honest
 * limitation, not a bug, and is documented in the Stage 10 report.
 */

export const PROMISE_TRACKER_LIMITS = {
  minAgeDays: 14,
} as const;

export interface PromiseTrackerDecisionInput {
  id: string;
  decisionText: string;
  meetingId: string | null;
  meetingHeadline: string | null;
  createdAt: string;
}

export interface PromiseTrackerActionInput {
  meetingId: string | null;
}

export interface PromiseGap {
  id: string;
  decisionText: string;
  meetingHeadline: string | null;
  createdAt: string;
  daysSinceDecision: number;
}

export interface PromiseTrackerReport {
  gaps: PromiseGap[];
  meetingScopedDecisionCount: number;
}

export function buildPromiseTracker(
  decisions: PromiseTrackerDecisionInput[],
  actions: PromiseTrackerActionInput[],
  now: Date,
): PromiseTrackerReport {
  const meetingsWithActions = new Set(actions.map((a) => a.meetingId).filter((id): id is string => id !== null));
  const meetingScoped = decisions.filter((d) => d.meetingId !== null);
  const dayMs = 24 * 60 * 60 * 1000;

  const gaps = meetingScoped
    .filter((d) => !meetingsWithActions.has(d.meetingId as string))
    .map((d) => ({
      id: d.id,
      decisionText: d.decisionText,
      meetingHeadline: d.meetingHeadline,
      createdAt: d.createdAt,
      daysSinceDecision: Math.floor((now.getTime() - new Date(d.createdAt).getTime()) / dayMs),
    }))
    .filter((d) => d.daysSinceDecision >= PROMISE_TRACKER_LIMITS.minAgeDays)
    .sort((a, b) => b.daysSinceDecision - a.daysSinceDecision);

  return { gaps, meetingScopedDecisionCount: meetingScoped.length };
}
