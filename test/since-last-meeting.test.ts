import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSinceLastMeetingReport,
  formatSinceLastMeetingSummary,
  SINCE_LAST_MEETING_LIMITS,
  type SinceLastMeetingData,
} from "../src/lib/since-last-meeting.ts";
import type { Suggestion, StatusHistoryEntry } from "../src/lib/types.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const CUTOFF = "2026-09-01T00:00:00.000Z";

function suggestion(overrides: Partial<Suggestion>): Suggestion {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Untitled",
    description: "",
    category: "other",
    improvement_reason: "",
    student_name: null,
    student_email: null,
    is_anonymous: true,
    status: "new",
    is_read: false,
    read_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    primary_suggestion_id: null,
    ...overrides,
  };
}

function historyEntry(overrides: Partial<StatusHistoryEntry>): StatusHistoryEntry {
  return {
    id: "10000000-0000-0000-0000-000000000001",
    suggestion_id: "00000000-0000-0000-0000-000000000001",
    from_status: "new",
    to_status: "reviewing",
    changed_by: "prez@example.org",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function emptyData(overrides: Partial<SinceLastMeetingData> = {}): SinceLastMeetingData {
  return {
    suggestions: [],
    statusHistory: [],
    suggestionTitleById: new Map(),
    decisions: [],
    actions: [],
    ...overrides,
  };
}

describe("buildSinceLastMeetingReport — new suggestions", () => {
  test("counts and lists only suggestions created strictly after the cutoff", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        suggestions: [
          suggestion({ id: "s1", title: "Before", created_at: "2026-08-01T00:00:00.000Z" }),
          suggestion({ id: "s2", title: "At cutoff", created_at: CUTOFF }),
          suggestion({ id: "s3", title: "After", created_at: "2026-09-05T00:00:00.000Z" }),
        ],
      }),
    );
    assert.equal(report.newSuggestionCount, 1);
    assert.deepEqual(report.newSuggestions.map((s) => s.title), ["After"]);
  });

  test("with no reference meeting (null cutoff), every suggestion on record counts as new", () => {
    const report = buildSinceLastMeetingReport(
      null,
      NOW,
      emptyData({ suggestions: [suggestion({ id: "s1", created_at: "2020-01-01T00:00:00.000Z" })] }),
    );
    assert.equal(report.newSuggestionCount, 1);
  });

  test("caps the inline list at SINCE_LAST_MEETING_LIMITS.listCap but keeps the true count", () => {
    const many = Array.from({ length: SINCE_LAST_MEETING_LIMITS.listCap + 5 }, (_, i) =>
      suggestion({ id: `s${i}`, created_at: "2026-09-10T00:00:00.000Z" }),
    );
    const report = buildSinceLastMeetingReport(CUTOFF, NOW, emptyData({ suggestions: many }));
    assert.equal(report.newSuggestionCount, SINCE_LAST_MEETING_LIMITS.listCap + 5);
    assert.equal(report.newSuggestions.length, SINCE_LAST_MEETING_LIMITS.listCap);
  });
});

describe("buildSinceLastMeetingReport — status changes", () => {
  test("excludes entries with a null from_status (the initial insert row)", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        statusHistory: [
          historyEntry({ from_status: null, to_status: "new", created_at: "2026-09-05T00:00:00.000Z" }),
          historyEntry({ from_status: "new", to_status: "reviewing", created_at: "2026-09-06T00:00:00.000Z" }),
        ],
      }),
    );
    assert.equal(report.statusChangeCount, 1);
    assert.equal(report.statusChanges[0]!.toStatus, "reviewing");
  });

  test("resolves the suggestion title from the lookup map, falling back honestly when unknown", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        statusHistory: [historyEntry({ suggestion_id: "known", from_status: "new", to_status: "approved", created_at: "2026-09-05T00:00:00.000Z" })],
        suggestionTitleById: new Map([["known", "Add recycling bins"]]),
      }),
    );
    assert.equal(report.statusChanges[0]!.title, "Add recycling bins");

    const orphaned = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        statusHistory: [historyEntry({ suggestion_id: "gone", from_status: "new", to_status: "approved", created_at: "2026-09-05T00:00:00.000Z" })],
      }),
    );
    assert.equal(orphaned.statusChanges[0]!.title, "Unknown suggestion");
  });
});

describe("buildSinceLastMeetingReport — decisions and actions", () => {
  test("only decisions/actions created after the cutoff are counted as new", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        decisions: [
          { id: "d1", decisionText: "Old decision", createdAt: "2026-08-01T00:00:00.000Z" },
          { id: "d2", decisionText: "New decision", createdAt: "2026-09-10T00:00:00.000Z" },
        ],
        actions: [
          { id: "a1", actionText: "Old action", createdAt: "2026-08-01T00:00:00.000Z", completed: false, deadline: null },
          { id: "a2", actionText: "New action", createdAt: "2026-09-10T00:00:00.000Z", completed: false, deadline: null },
        ],
      }),
    );
    assert.equal(report.newDecisionCount, 1);
    assert.equal(report.newDecisions[0]!.decisionText, "New decision");
    assert.equal(report.newActionCount, 1);
    assert.equal(report.newActions[0]!.actionText, "New action");
  });
});

describe("buildSinceLastMeetingReport — overdue / due soon / needs attention", () => {
  test("an incomplete action past its deadline counts as overdue, not due soon", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        actions: [{ id: "a1", actionText: "Late", createdAt: "2026-08-01T00:00:00.000Z", completed: false, deadline: "2026-09-01T00:00:00.000Z" }],
      }),
    );
    assert.equal(report.overdueActionCount, 1);
    assert.equal(report.dueSoonActionCount, 0);
    assert.match(report.needsAttention.join(";"), /1 action item overdue/);
  });

  test("a completed action past its deadline is never overdue", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        actions: [{ id: "a1", actionText: "Done", createdAt: "2026-08-01T00:00:00.000Z", completed: true, deadline: "2026-09-01T00:00:00.000Z" }],
      }),
    );
    assert.equal(report.overdueActionCount, 0);
    assert.equal(report.needsAttention.length, 0);
  });

  test("an incomplete action due within the window counts as due soon, not overdue", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        actions: [{ id: "a1", actionText: "Soon", createdAt: "2026-08-01T00:00:00.000Z", completed: false, deadline: "2026-09-25T00:00:00.000Z" }],
      }),
    );
    assert.equal(report.overdueActionCount, 0);
    assert.equal(report.dueSoonActionCount, 1);
  });

  test("a suggestion still 'new' after the stale window is flagged in needsAttention", () => {
    const report = buildSinceLastMeetingReport(
      CUTOFF,
      NOW,
      emptyData({
        suggestions: [suggestion({ id: "s1", status: "new", created_at: "2026-08-01T00:00:00.000Z" })],
      }),
    );
    assert.match(report.needsAttention.join(";"), /1 suggestion still unreviewed/);
  });

  test("no signals at all means an empty needsAttention array, never a fabricated warning", () => {
    const report = buildSinceLastMeetingReport(CUTOFF, NOW, emptyData());
    assert.deepEqual(report.needsAttention, []);
  });
});

describe("formatSinceLastMeetingSummary", () => {
  test("names the reference meeting when one was found", () => {
    const report = buildSinceLastMeetingReport(CUTOFF, NOW, emptyData());
    const summary = formatSinceLastMeetingSummary(report, "Sept assembly");
    assert.match(summary, /Since "Sept assembly":/);
  });

  test("says plainly when no prior meeting exists, rather than implying one does", () => {
    const report = buildSinceLastMeetingReport(null, NOW, emptyData());
    const summary = formatSinceLastMeetingSummary(report, null);
    assert.match(summary, /No prior saved meeting was found/);
  });
});
