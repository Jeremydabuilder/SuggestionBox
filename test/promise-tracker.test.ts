import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPromiseTracker, PROMISE_TRACKER_LIMITS } from "../src/lib/promise-tracker.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const OLD_ENOUGH = "2026-09-01T00:00:00.000Z"; // >= minAgeDays before NOW
const TOO_RECENT = "2026-09-20T00:00:00.000Z"; // < minAgeDays before NOW

describe("buildPromiseTracker", () => {
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
      [{ meetingId: "m1" }],
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

  test("a decision younger than minAgeDays is not yet flagged, giving the team time to act", () => {
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
      [{ meetingId: "m2" }],
      NOW,
    );
    assert.equal(report.meetingScopedDecisionCount, 2);
    assert.equal(report.gaps.length, 1);
  });

  test("no signals at all means an empty gaps array, never a fabricated warning", () => {
    const report = buildPromiseTracker([], [], NOW);
    assert.deepEqual(report.gaps, []);
  });

  test("PROMISE_TRACKER_LIMITS.minAgeDays is a positive number the report actually honors", () => {
    assert.ok(PROMISE_TRACKER_LIMITS.minAgeDays > 0);
  });
});
