import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPromiseTracker, PROMISE_TRACKER_LIMITS, type PromiseTrackerActionInput } from "../src/lib/promise-tracker.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const OLD_ENOUGH = "2026-09-01T00:00:00.000Z"; // >= every threshold before NOW
const TOO_RECENT = "2026-09-20T00:00:00.000Z"; // < every threshold before NOW

function action(overrides: Partial<PromiseTrackerActionInput>): PromiseTrackerActionInput {
  return {
    id: "a1",
    actionText: "Do the thing",
    meetingId: null,
    completed: false,
    createdAt: OLD_ENOUGH,
    updatedAt: OLD_ENOUGH,
    ...overrides,
  };
}

describe("buildPromiseTracker — gap 1: decision with no action for its meeting", () => {
  test("a meeting-scoped decision with zero actions for that meeting, old enough, is flagged as a gap", () => {
    const report = buildPromiseTracker(
      [{ id: "d1", decisionText: "Add recycling bins", meetingId: "m1", meetingHeadline: "Sept assembly", createdAt: OLD_ENOUGH }],
      [],
      NOW,
    );
    assert.equal(report.gaps.length, 1);
    assert.equal(report.gaps[0]!.id, "d1");
  });

  test("a decision whose meeting already has an action recorded is not a gap", () => {
    const report = buildPromiseTracker(
      [{ id: "d1", decisionText: "Add recycling bins", meetingId: "m1", meetingHeadline: null, createdAt: OLD_ENOUGH }],
      [action({ meetingId: "m1" })],
      NOW,
    );
    assert.equal(report.gaps.length, 0);
  });

  test("a standalone decision (no meetingId) is never flagged — there's no structural link to check", () => {
    const report = buildPromiseTracker(
      [{ id: "d1", decisionText: "Standalone", meetingId: null, meetingHeadline: null, createdAt: OLD_ENOUGH }],
      [],
      NOW,
    );
    assert.equal(report.gaps.length, 0);
    assert.equal(report.meetingScopedDecisionCount, 0);
  });

  test("a decision younger than the threshold is not yet flagged, giving the team time to act", () => {
    const report = buildPromiseTracker(
      [{ id: "d1", decisionText: "Just decided", meetingId: "m1", meetingHeadline: null, createdAt: TOO_RECENT }],
      [],
      NOW,
    );
    assert.equal(report.gaps.length, 0);
  });

  test("daysSinceDecision is computed correctly and gaps sort oldest-first", () => {
    const report = buildPromiseTracker(
      [
        { id: "newer", decisionText: "B", meetingId: "m1", meetingHeadline: null, createdAt: "2026-09-05T00:00:00.000Z" },
        { id: "older", decisionText: "A", meetingId: "m2", meetingHeadline: null, createdAt: "2026-08-01T00:00:00.000Z" },
      ],
      [],
      NOW,
    );
    assert.equal(report.gaps[0]!.id, "older");
    assert.ok(report.gaps[0]!.daysSinceDecision > report.gaps[1]!.daysSinceDecision);
  });

  test("meetingScopedDecisionCount counts all meeting-tied decisions, not just the gaps", () => {
    const report = buildPromiseTracker(
      [
        { id: "d1", decisionText: "A", meetingId: "m1", meetingHeadline: null, createdAt: OLD_ENOUGH },
        { id: "d2", decisionText: "B", meetingId: "m2", meetingHeadline: null, createdAt: OLD_ENOUGH },
      ],
      [action({ meetingId: "m2" })],
      NOW,
    );
    assert.equal(report.meetingScopedDecisionCount, 2);
    assert.equal(report.gaps.length, 1);
  });

  test("no signals at all means an empty gaps array, never a fabricated warning", () => {
    const report = buildPromiseTracker([], [], NOW);
    assert.deepEqual(report.gaps, []);
    assert.deepEqual(report.suggestionGaps, []);
    assert.deepEqual(report.staleActionGaps, []);
  });
});

describe("buildPromiseTracker — gap 2: approved suggestion with no linked action", () => {
  test("an approved suggestion with zero linked actions, old enough, is flagged", () => {
    const report = buildPromiseTracker([], [], NOW, [
      { id: "s1", title: "More recycling bins", status: "approved", createdAt: OLD_ENOUGH, linkedActionCount: 0 },
    ]);
    assert.equal(report.suggestionGaps.length, 1);
    assert.equal(report.suggestionGaps[0]!.id, "s1");
  });

  test("an approved suggestion WITH a linked action is not a gap", () => {
    const report = buildPromiseTracker([], [], NOW, [
      { id: "s1", title: "More recycling bins", status: "approved", createdAt: OLD_ENOUGH, linkedActionCount: 1 },
    ]);
    assert.equal(report.suggestionGaps.length, 0);
  });

  test("a non-approved suggestion is never flagged, regardless of linked actions", () => {
    const report = buildPromiseTracker([], [], NOW, [
      { id: "s1", title: "Still under review", status: "reviewing", createdAt: OLD_ENOUGH, linkedActionCount: 0 },
    ]);
    assert.equal(report.suggestionGaps.length, 0);
  });

  test("an approved suggestion younger than the threshold is not yet flagged", () => {
    const report = buildPromiseTracker([], [], NOW, [
      { id: "s1", title: "Just approved", status: "approved", createdAt: TOO_RECENT, linkedActionCount: 0 },
    ]);
    assert.equal(report.suggestionGaps.length, 0);
  });
});

describe("buildPromiseTracker — gap 3: a long-running open action nobody has updated", () => {
  test("an open action whose updatedAt still equals createdAt (never touched), old enough, is flagged", () => {
    const report = buildPromiseTracker([], [action({ id: "a1", createdAt: OLD_ENOUGH, updatedAt: OLD_ENOUGH, completed: false })], NOW);
    assert.equal(report.staleActionGaps.length, 1);
    assert.equal(report.staleActionGaps[0]!.id, "a1");
  });

  test("an action that HAS been updated since creation is not flagged", () => {
    const report = buildPromiseTracker(
      [],
      [action({ id: "a1", createdAt: OLD_ENOUGH, updatedAt: "2026-09-15T00:00:00.000Z", completed: false })],
      NOW,
    );
    assert.equal(report.staleActionGaps.length, 0);
  });

  test("a completed action is never flagged as stale, even if never updated after completion", () => {
    const report = buildPromiseTracker([], [action({ id: "a1", createdAt: OLD_ENOUGH, updatedAt: OLD_ENOUGH, completed: true })], NOW);
    assert.equal(report.staleActionGaps.length, 0);
  });

  test("a recently-created untouched action is not yet flagged", () => {
    const report = buildPromiseTracker([], [action({ id: "a1", createdAt: TOO_RECENT, updatedAt: TOO_RECENT, completed: false })], NOW);
    assert.equal(report.staleActionGaps.length, 0);
  });
});

describe("PROMISE_TRACKER_LIMITS", () => {
  test("every threshold is a positive number the report actually honors", () => {
    assert.ok(PROMISE_TRACKER_LIMITS.minDecisionAgeDays > 0);
    assert.ok(PROMISE_TRACKER_LIMITS.minSuggestionAgeDays > 0);
    assert.ok(PROMISE_TRACKER_LIMITS.minStaleActionAgeDays > 0);
  });
});
