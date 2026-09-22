/**
 * Explainable, per-suggestion Needs Attention signals. Deliberately NOT
 * one mysterious AI score: every suggestion gets a list of NAMED,
 * factual signals (each one independently true or false, each with a
 * fixed human-readable reason), and sorting by "needs attention" is
 * documented as exactly "count of active signals, oldest first as a
 * tiebreaker" — a formula anyone can recompute by hand, not a black box.
 *
 * No student emotion, identity, popularity, writing quality, or any
 * personal characteristic is read anywhere in this file — every signal
 * below is a plain fact about dates, statuses, and linked records.
 */

export const ATTENTION_SIGNALS = [
  "unread",
  "aging",
  "repeated",
  "approved_no_followup",
  "overdue_action",
  "upcoming_deadline",
  "stale_status",
  "unreviewed_duplicate_cluster",
] as const;
export type AttentionSignalKind = (typeof ATTENTION_SIGNALS)[number];

export const ATTENTION_SIGNAL_TEXT: Record<AttentionSignalKind, string> = {
  unread: "Not yet viewed by a co-president",
  aging: "Still new after a while",
  repeated: "Part of a repeated cluster of related suggestions",
  approved_no_followup: "Approved, but no decision or action is linked to it yet",
  overdue_action: "A linked action item is overdue",
  upcoming_deadline: "A linked action item is due soon",
  stale_status: "Status hasn't changed in an unusually long time",
  unreviewed_duplicate_cluster: "In a high-confidence duplicate cluster that hasn't been reviewed",
};

export const ATTENTION_LIMITS = {
  agingDays: 7,
  staleStatusDays: 21,
  clusterRepeatedMinSize: 3,
} as const;

export interface AttentionInput {
  id: string;
  isRead: boolean;
  status: string;
  createdAt: string;
  /** Size of the duplicate/topic cluster this suggestion belongs to (1 if none). */
  clusterSize: number;
  /** True if this suggestion sits in a cluster with an unreviewed (state="suggested") high-confidence edge. */
  inUnreviewedHighConfidenceCluster: boolean;
  /** True if any decision or action citation references this suggestion. */
  hasFollowUp: boolean;
  hasOverdueLinkedAction: boolean;
  hasUpcomingDeadlineLinkedAction: boolean;
  /** ISO timestamp of the most recent status_history row for this suggestion, or null if it has never changed. */
  lastStatusChangeAt: string | null;
}

export interface AttentionResult {
  id: string;
  signals: AttentionSignalKind[];
  /** signals.length — the documented, recomputable sort key. Never shown to a president as an unexplained score without the signal list next to it. */
  signalCount: number;
}

function daysBetween(a: number, b: number): number {
  return (a - b) / (24 * 60 * 60 * 1000);
}

/**
 * One suggestion in, one factual signal list out. Pure and deterministic
 * — the same input always produces the same signals, and every signal
 * is independently checkable against ATTENTION_SIGNAL_TEXT.
 */
export function computeAttentionSignals(input: AttentionInput, now: Date): AttentionResult {
  const nowMs = now.getTime();
  const signals: AttentionSignalKind[] = [];

  if (!input.isRead) signals.push("unread");

  const ageDays = daysBetween(nowMs, new Date(input.createdAt).getTime());
  if (input.status === "new" && ageDays >= ATTENTION_LIMITS.agingDays) signals.push("aging");

  if (input.clusterSize >= ATTENTION_LIMITS.clusterRepeatedMinSize) signals.push("repeated");

  if (input.status === "approved" && !input.hasFollowUp) signals.push("approved_no_followup");

  if (input.hasOverdueLinkedAction) signals.push("overdue_action");
  if (input.hasUpcomingDeadlineLinkedAction) signals.push("upcoming_deadline");

  if (input.lastStatusChangeAt) {
    const sinceChangeDays = daysBetween(nowMs, new Date(input.lastStatusChangeAt).getTime());
    if (sinceChangeDays >= ATTENTION_LIMITS.staleStatusDays) signals.push("stale_status");
  }

  if (input.inUnreviewedHighConfidenceCluster) signals.push("unreviewed_duplicate_cluster");

  return { id: input.id, signals, signalCount: signals.length };
}

export type AttentionSortMode = "newest" | "oldest" | "most_repeated" | "needs_attention" | "recently_active";

export interface SortableSuggestion {
  id: string;
  createdAt: string;
  updatedAt: string;
  clusterSize: number;
}

/**
 * The five required sort modes. "needs_attention" sorts by signalCount
 * descending, tiebroken by age (oldest first) — the exact, documented
 * formula, not a hidden weighting. Stable: two suggestions that compare
 * equal keep their original relative order (Array.prototype.sort is
 * stable in every JS engine this app targets).
 */
export function sortByAttentionMode<T extends SortableSuggestion>(
  items: T[],
  mode: AttentionSortMode,
  signalCountById: Map<string, number>,
): T[] {
  const copy = [...items];
  switch (mode) {
    case "newest":
      return copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case "oldest":
      return copy.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case "most_repeated":
      return copy.sort((a, b) => b.clusterSize - a.clusterSize);
    case "recently_active":
      return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    case "needs_attention":
      return copy.sort((a, b) => {
        const diff = (signalCountById.get(b.id) ?? 0) - (signalCountById.get(a.id) ?? 0);
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }
}
