import type { Suggestion, StatusHistoryEntry } from "./types.ts";

/**
 * Pure, deterministic "what changed since the reference meeting" report
 * builder. No Groq call anywhere in here — every number and list below is
 * a straight filter/sort/count over already-fetched rows. Kept free of
 * `server-only` and any I/O on purpose, matching this codebase's existing
 * convention (see lib/memory-retrieval.ts), so it stays directly
 * unit-testable; the "use server" orchestrator
 * (since-last-meeting-actions.ts) is the only place that talks to
 * Supabase.
 */

export const SINCE_LAST_MEETING_LIMITS = {
  /** Cap on each list rendered inline — counts above this are still reported in full via the *Count fields. */
  listCap: 20,
  dueSoonDays: 7,
  staleNewDays: 7,
} as const;

export interface SlmDecisionInput {
  id: string;
  decisionText: string;
  createdAt: string;
}

export interface SlmActionInput {
  id: string;
  actionText: string;
  createdAt: string;
  completed: boolean;
  deadline: string | null;
}

export interface SinceLastMeetingData {
  suggestions: Suggestion[];
  statusHistory: StatusHistoryEntry[];
  suggestionTitleById: Map<string, string>;
  decisions: SlmDecisionInput[];
  actions: SlmActionInput[];
}

export interface SinceLastMeetingReport {
  newSuggestions: Array<{ id: string; title: string; status: string }>;
  newSuggestionCount: number;
  statusChanges: Array<{ suggestionId: string; title: string; fromStatus: string | null; toStatus: string }>;
  statusChangeCount: number;
  newDecisions: Array<{ id: string; decisionText: string }>;
  newDecisionCount: number;
  newActions: Array<{ id: string; actionText: string }>;
  newActionCount: number;
  overdueActionCount: number;
  dueSoonActionCount: number;
  needsAttention: string[];
}

/** `referenceTimestamp === null` means no prior saved meeting exists — everything on record counts as "since". */
export function buildSinceLastMeetingReport(
  referenceTimestamp: string | null,
  now: Date,
  data: SinceLastMeetingData,
): SinceLastMeetingReport {
  const cutoff = referenceTimestamp ? new Date(referenceTimestamp).getTime() : -Infinity;
  const nowMs = now.getTime();

  const newSuggestionsAll = data.suggestions
    .filter((s) => new Date(s.created_at).getTime() > cutoff)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const statusChangesAll = data.statusHistory
    .filter((h) => h.from_status !== null && new Date(h.created_at).getTime() > cutoff)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((h) => ({
      suggestionId: h.suggestion_id,
      title: data.suggestionTitleById.get(h.suggestion_id) ?? "Unknown suggestion",
      fromStatus: h.from_status,
      toStatus: h.to_status,
    }));

  const newDecisionsAll = data.decisions
    .filter((d) => new Date(d.createdAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const newActionsAll = data.actions
    .filter((a) => new Date(a.createdAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const dueSoonCutoffMs = nowMs + SINCE_LAST_MEETING_LIMITS.dueSoonDays * 24 * 60 * 60 * 1000;
  const overdueActions = data.actions.filter(
    (a) => !a.completed && a.deadline !== null && new Date(a.deadline).getTime() < nowMs,
  );
  const dueSoonActions = data.actions.filter(
    (a) =>
      !a.completed &&
      a.deadline !== null &&
      new Date(a.deadline).getTime() >= nowMs &&
      new Date(a.deadline).getTime() <= dueSoonCutoffMs,
  );

  const staleCutoffMs = nowMs - SINCE_LAST_MEETING_LIMITS.staleNewDays * 24 * 60 * 60 * 1000;
  const staleNew = data.suggestions.filter(
    (s) => s.status === "new" && new Date(s.created_at).getTime() < staleCutoffMs,
  );

  const needsAttention: string[] = [];
  if (overdueActions.length > 0) {
    needsAttention.push(`${overdueActions.length} action item${overdueActions.length === 1 ? "" : "s"} overdue`);
  }
  if (dueSoonActions.length > 0) {
    needsAttention.push(
      `${dueSoonActions.length} action item${dueSoonActions.length === 1 ? "" : "s"} due within ${SINCE_LAST_MEETING_LIMITS.dueSoonDays} days`,
    );
  }
  if (staleNew.length > 0) {
    needsAttention.push(
      `${staleNew.length} suggestion${staleNew.length === 1 ? "" : "s"} still unreviewed after ${SINCE_LAST_MEETING_LIMITS.staleNewDays} days`,
    );
  }

  const { listCap } = SINCE_LAST_MEETING_LIMITS;
  return {
    newSuggestions: newSuggestionsAll.slice(0, listCap).map((s) => ({ id: s.id, title: s.title, status: s.status })),
    newSuggestionCount: newSuggestionsAll.length,
    statusChanges: statusChangesAll.slice(0, listCap),
    statusChangeCount: statusChangesAll.length,
    newDecisions: newDecisionsAll.slice(0, listCap).map((d) => ({ id: d.id, decisionText: d.decisionText })),
    newDecisionCount: newDecisionsAll.length,
    newActions: newActionsAll.slice(0, listCap).map((a) => ({ id: a.id, actionText: a.actionText })),
    newActionCount: newActionsAll.length,
    overdueActionCount: overdueActions.length,
    dueSoonActionCount: dueSoonActions.length,
    needsAttention,
  };
}

export function formatSinceLastMeetingSummary(report: SinceLastMeetingReport, meetingHeadline: string | null): string {
  const lines: string[] = [];
  lines.push(
    meetingHeadline
      ? `Since "${meetingHeadline}":`
      : "No prior saved meeting was found — here's everything on record:",
  );
  lines.push(
    `${report.newSuggestionCount} new suggestion${report.newSuggestionCount === 1 ? "" : "s"}, ` +
      `${report.statusChangeCount} status change${report.statusChangeCount === 1 ? "" : "s"}, ` +
      `${report.newDecisionCount} new decision${report.newDecisionCount === 1 ? "" : "s"}, ` +
      `${report.newActionCount} new action item${report.newActionCount === 1 ? "" : "s"}.`,
  );
  if (report.needsAttention.length > 0) {
    lines.push(`Needs attention: ${report.needsAttention.join("; ")}.`);
  }
  return lines.join("\n");
}
