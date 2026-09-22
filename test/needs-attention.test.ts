import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAttentionSignals,
  sortByAttentionMode,
  ATTENTION_LIMITS,
  ATTENTION_SIGNAL_TEXT,
  ATTENTION_SIGNALS,
  type AttentionInput,
} from "../src/lib/needs-attention.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z");

function input(overrides: Partial<AttentionInput>): AttentionInput {
  return {
    id: "s1",
    isRead: true,
    status: "reviewing",
    createdAt: "2026-09-20T00:00:00.000Z",
    clusterSize: 1,
    inUnreviewedHighConfidenceCluster: false,
    hasFollowUp: true,
    hasOverdueLinkedAction: false,
    hasUpcomingDeadlineLinkedAction: false,
    lastStatusChangeAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeAttentionSignals — every signal is independently checkable", () => {
  test("a fully unremarkable suggestion has zero signals", () => {
    const result = computeAttentionSignals(input({}), NOW);
    assert.deepEqual(result.signals, []);
    assert.equal(result.signalCount, 0);
  });

  test("unread", () => {
    const result = computeAttentionSignals(input({ isRead: false }), NOW);
    assert.ok(result.signals.includes("unread"));
  });

  test("aging: status still 'new' after the aging threshold", () => {
    const old = new Date(NOW.getTime() - (ATTENTION_LIMITS.agingDays + 1) * 86_400_000).toISOString();
    const result = computeAttentionSignals(input({ status: "new", createdAt: old }), NOW);
    assert.ok(result.signals.includes("aging"));
  });

  test("aging does not fire for a status other than 'new', even if old", () => {
    const old = new Date(NOW.getTime() - (ATTENTION_LIMITS.agingDays + 5) * 86_400_000).toISOString();
    const result = computeAttentionSignals(input({ status: "reviewing", createdAt: old }), NOW);
    assert.ok(!result.signals.includes("aging"));
  });

  test("aging does not fire before the threshold", () => {
    const recent = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
    const result = computeAttentionSignals(input({ status: "new", createdAt: recent }), NOW);
    assert.ok(!result.signals.includes("aging"));
  });

  test("repeated: clusterSize at or above the threshold", () => {
    const result = computeAttentionSignals(input({ clusterSize: ATTENTION_LIMITS.clusterRepeatedMinSize }), NOW);
    assert.ok(result.signals.includes("repeated"));
  });

  test("repeated does not fire below the threshold", () => {
    const result = computeAttentionSignals(input({ clusterSize: ATTENTION_LIMITS.clusterRepeatedMinSize - 1 }), NOW);
    assert.ok(!result.signals.includes("repeated"));
  });

  test("approved_no_followup: approved with no linked decision/action", () => {
    const result = computeAttentionSignals(input({ status: "approved", hasFollowUp: false }), NOW);
    assert.ok(result.signals.includes("approved_no_followup"));
  });

  test("approved_no_followup does not fire when a follow-up exists", () => {
    const result = computeAttentionSignals(input({ status: "approved", hasFollowUp: true }), NOW);
    assert.ok(!result.signals.includes("approved_no_followup"));
  });

  test("approved_no_followup does not fire for a non-approved status", () => {
    const result = computeAttentionSignals(input({ status: "reviewing", hasFollowUp: false }), NOW);
    assert.ok(!result.signals.includes("approved_no_followup"));
  });

  test("overdue_action and upcoming_deadline pass through directly", () => {
    const overdue = computeAttentionSignals(input({ hasOverdueLinkedAction: true }), NOW);
    assert.ok(overdue.signals.includes("overdue_action"));
    const upcoming = computeAttentionSignals(input({ hasUpcomingDeadlineLinkedAction: true }), NOW);
    assert.ok(upcoming.signals.includes("upcoming_deadline"));
  });

  test("stale_status: last status change older than the threshold", () => {
    const old = new Date(NOW.getTime() - (ATTENTION_LIMITS.staleStatusDays + 1) * 86_400_000).toISOString();
    const result = computeAttentionSignals(input({ lastStatusChangeAt: old }), NOW);
    assert.ok(result.signals.includes("stale_status"));
  });

  test("stale_status does not fire when there is no status_history at all", () => {
    const result = computeAttentionSignals(input({ lastStatusChangeAt: null }), NOW);
    assert.ok(!result.signals.includes("stale_status"));
  });

  test("unreviewed_duplicate_cluster passes through directly", () => {
    const result = computeAttentionSignals(input({ inUnreviewedHighConfidenceCluster: true }), NOW);
    assert.ok(result.signals.includes("unreviewed_duplicate_cluster"));
  });

  test("multiple signals can be true at once, and signalCount reflects the exact count", () => {
    const result = computeAttentionSignals(input({ isRead: false, hasOverdueLinkedAction: true, clusterSize: 5 }), NOW);
    assert.equal(result.signalCount, 3);
    assert.deepEqual(new Set(result.signals), new Set(["unread", "repeated", "overdue_action"]));
  });

  test("every ATTENTION_SIGNALS entry has fixed, non-empty human text", () => {
    for (const signal of ATTENTION_SIGNALS) {
      assert.equal(typeof ATTENTION_SIGNAL_TEXT[signal], "string");
      assert.ok(ATTENTION_SIGNAL_TEXT[signal].length > 0);
    }
  });

  test("no field anywhere in AttentionInput reads emotion, identity, popularity, or writing quality", () => {
    const keys = Object.keys(input({}));
    for (const key of keys) {
      assert.doesNotMatch(key.toLowerCase(), /emotion|sentiment|identity|popular|quality|name|email|grade|demographic/);
    }
  });
});

describe("sortByAttentionMode — five required, documented modes", () => {
  const items = [
    { id: "a", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z", clusterSize: 1 },
    { id: "b", createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z", clusterSize: 5 },
    { id: "c", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", clusterSize: 2 },
  ];
  const signalCounts = new Map([["a", 0], ["b", 1], ["c", 3]]);

  test("newest: most recently created first", () => {
    const sorted = sortByAttentionMode(items, "newest", signalCounts);
    assert.deepEqual(sorted.map((i) => i.id), ["b", "c", "a"]);
  });

  test("oldest: least recently created first", () => {
    const sorted = sortByAttentionMode(items, "oldest", signalCounts);
    assert.deepEqual(sorted.map((i) => i.id), ["a", "c", "b"]);
  });

  test("most_repeated: largest clusterSize first", () => {
    const sorted = sortByAttentionMode(items, "most_repeated", signalCounts);
    assert.deepEqual(sorted.map((i) => i.id), ["b", "c", "a"]);
  });

  test("recently_active: most recently updated first", () => {
    const sorted = sortByAttentionMode(items, "recently_active", signalCounts);
    assert.deepEqual(sorted.map((i) => i.id), ["b", "a", "c"]);
  });

  test("needs_attention: highest signalCount first, oldest as tiebreaker", () => {
    const sorted = sortByAttentionMode(items, "needs_attention", signalCounts);
    assert.deepEqual(sorted.map((i) => i.id), ["c", "b", "a"]);
  });

  test("needs_attention tiebreak: equal signalCount falls back to oldest-first", () => {
    const tied = [
      { id: "x", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z", clusterSize: 1 },
      { id: "y", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", clusterSize: 1 },
    ];
    const equalCounts = new Map([["x", 2], ["y", 2]]);
    const sorted = sortByAttentionMode(tied, "needs_attention", equalCounts);
    assert.deepEqual(sorted.map((i) => i.id), ["y", "x"]);
  });

  test("sorting never mutates the input array", () => {
    const original = [...items];
    sortByAttentionMode(items, "newest", signalCounts);
    assert.deepEqual(items, original);
  });
});
