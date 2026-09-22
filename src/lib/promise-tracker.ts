/**
 * Pure, deterministic promise/follow-through gap detection. Three
 * independent, factually-checkable gap types — never a single opaque
 * "broken promise" verdict, and always cautious wording, since the
 * database this reads from can be incomplete (a decision made verbally
 * and never logged, an action tracked outside this app). Nobody is ever
 * named or accused; every gap is phrased as a fact about records, not a
 * claim about a person.
 */

export const PROMISE_TRACKER_LIMITS = {
  minDecisionAgeDays: 14,
  minSuggestionAgeDays: 14,
  minStaleActionAgeDays: 21,
} as const;

/* ---------------------------------------------------------------- */
/* Gap 1: an approved decision from a meeting with no action recorded */
/* against that same meeting. Unchanged from the original version —   */
/* still the only structural link this schema has between a decision  */
/* and a follow-up action is the shared meetingId.                    */
/* ---------------------------------------------------------------- */

export interface PromiseTrackerDecisionInput {
  id: string;
  decisionText: string;
  meetingId: string | null;
  meetingHeadline: string | null;
  createdAt: string;
}

export interface PromiseGap {
  id: string;
  decisionText: string;
  meetingHeadline: string | null;
  createdAt: string;
  daysSinceDecision: number;
}

/* ---------------------------------------------------------------- */
/* Gap 2: an approved suggestion with zero linked action items.       */
/* ---------------------------------------------------------------- */

export interface PromiseTrackerSuggestionInput {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  /** How many action items cite this suggestion (meeting_action_citations) — 0 means no recorded follow-up at all. */
  linkedActionCount: number;
}

export interface SuggestionFollowUpGap {
  id: string;
  title: string;
  daysSinceCreated: number;
}

/* ---------------------------------------------------------------- */
/* Gap 3: an open action item nobody has touched since it was created. */
/* ---------------------------------------------------------------- */

export interface PromiseTrackerActionInput {
  id: string;
  actionText: string;
  meetingId: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaleActionGap {
  id: string;
  actionText: string;
  daysSinceCreated: number;
}

export interface PromiseTrackerReport {
  gaps: PromiseGap[];
  meetingScopedDecisionCount: number;
  suggestionGaps: SuggestionFollowUpGap[];
  staleActionGaps: StaleActionGap[];
}

function daysSince(now: Date, iso: string): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export function buildPromiseTracker(
  decisions: PromiseTrackerDecisionInput[],
  actions: PromiseTrackerActionInput[],
  now: Date,
  suggestions: PromiseTrackerSuggestionInput[] = [],
): PromiseTrackerReport {
  const meetingsWithActions = new Set(actions.map((a) => a.meetingId).filter((id): id is string => id !== null));
  const meetingScoped = decisions.filter((d) => d.meetingId !== null);

  const gaps = meetingScoped
    .filter((d) => !meetingsWithActions.has(d.meetingId as string))
    .map((d) => ({
      id: d.id,
      decisionText: d.decisionText,
      meetingHeadline: d.meetingHeadline,
      createdAt: d.createdAt,
      daysSinceDecision: daysSince(now, d.createdAt),
    }))
    .filter((d) => d.daysSinceDecision >= PROMISE_TRACKER_LIMITS.minDecisionAgeDays)
    .sort((a, b) => b.daysSinceDecision - a.daysSinceDecision);

  const suggestionGaps = suggestions
    .filter((s) => s.status === "approved" && s.linkedActionCount === 0)
    .map((s) => ({ id: s.id, title: s.title, daysSinceCreated: daysSince(now, s.createdAt) }))
    .filter((s) => s.daysSinceCreated >= PROMISE_TRACKER_LIMITS.minSuggestionAgeDays)
    .sort((a, b) => b.daysSinceCreated - a.daysSinceCreated);

  const staleActionGaps = actions
    .filter((a) => !a.completed && a.updatedAt === a.createdAt)
    .map((a) => ({ id: a.id, actionText: a.actionText, daysSinceCreated: daysSince(now, a.createdAt) }))
    .filter((a) => a.daysSinceCreated >= PROMISE_TRACKER_LIMITS.minStaleActionAgeDays)
    .sort((a, b) => b.daysSinceCreated - a.daysSinceCreated);

  return { gaps, meetingScopedDecisionCount: meetingScoped.length, suggestionGaps, staleActionGaps };
}
