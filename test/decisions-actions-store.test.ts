import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  actionItemInputSchema,
  classifyDeadline,
  decisionInputSchema,
  resolveSuggestionCitations,
  updateActionItemInputSchema,
  updateDecisionInputSchema,
} from "../src/lib/decisions-actions-store.ts";

const REAL_ID_A = "11111111-1111-4111-8111-111111111111";
const REAL_ID_B = "22222222-2222-4222-8222-222222222222";
const FABRICATED_ID = "99999999-9999-4999-8999-999999999999";

describe("resolveSuggestionCitations — the only place a decision/action citation is trusted", () => {
  test("keeps ids that exist", () => {
    const resolved = resolveSuggestionCitations([REAL_ID_A, REAL_ID_B], new Set([REAL_ID_A, REAL_ID_B]));
    assert.deepEqual(resolved, [REAL_ID_A, REAL_ID_B]);
  });

  test("drops a fabricated or inaccessible id", () => {
    const resolved = resolveSuggestionCitations([REAL_ID_A, FABRICATED_ID], new Set([REAL_ID_A]));
    assert.deepEqual(resolved, [REAL_ID_A]);
  });

  test("collapses duplicates to a single citation", () => {
    const resolved = resolveSuggestionCitations([REAL_ID_A, REAL_ID_A, REAL_ID_A], new Set([REAL_ID_A]));
    assert.deepEqual(resolved, [REAL_ID_A]);
  });

  test("an entirely missing/empty request resolves to nothing", () => {
    assert.deepEqual(resolveSuggestionCitations([], new Set([REAL_ID_A])), []);
  });

  test("everything fabricated resolves to an empty list, never throws", () => {
    assert.deepEqual(resolveSuggestionCitations([FABRICATED_ID], new Set()), []);
  });
});

describe("decision/action input schemas", () => {
  test("a decision needs non-empty text; meetingId and citations are optional", () => {
    const ok = decisionInputSchema.safeParse({ decisionText: "Approve the new vending policy.", meetingId: null, citedSuggestionIds: [] });
    assert.equal(ok.success, true);

    const empty = decisionInputSchema.safeParse({ decisionText: "   ", meetingId: null, citedSuggestionIds: [] });
    assert.equal(empty.success, false);
  });

  test("update requires an id in addition to the base fields", () => {
    const withoutId = updateDecisionInputSchema.safeParse({ decisionText: "x", meetingId: null, citedSuggestionIds: [] });
    assert.equal(withoutId.success, false);
    const withId = updateDecisionInputSchema.safeParse({ id: REAL_ID_A, decisionText: "x", meetingId: null, citedSuggestionIds: [] });
    assert.equal(withId.success, true);
  });

  test("an action item accepts a null deadline or a date-only string, never a full timestamp", () => {
    const noDeadline = actionItemInputSchema.safeParse({ actionText: "Email the custodian.", deadline: null, meetingId: null, citedSuggestionIds: [] });
    assert.equal(noDeadline.success, true);

    const dateOnly = actionItemInputSchema.safeParse({ actionText: "Email the custodian.", deadline: "2026-10-01", meetingId: null, citedSuggestionIds: [] });
    assert.equal(dateOnly.success, true);

    const timestamp = actionItemInputSchema.safeParse({ actionText: "Email the custodian.", deadline: "2026-10-01T00:00:00Z", meetingId: null, citedSuggestionIds: [] });
    assert.equal(timestamp.success, false);
  });

  test("no schema in this file defines an owner/assignee-shaped field", () => {
    for (const schema of [decisionInputSchema, updateDecisionInputSchema, actionItemInputSchema, updateActionItemInputSchema]) {
      const shape = schema.shape as Record<string, unknown>;
      assert.equal("owner" in shape, false);
      assert.equal("assignee" in shape, false);
      assert.equal("assigned_to" in shape, false);
      assert.equal("assignedTo" in shape, false);
    }
  });
});

describe("classifyDeadline", () => {
  const today = new Date("2026-09-21T15:00:00.000Z");

  test("no deadline classifies as none", () => {
    assert.equal(classifyDeadline(null, today), "none");
  });

  test("yesterday is overdue", () => {
    assert.equal(classifyDeadline("2026-09-20", today), "overdue");
  });

  test("today is due soon, not overdue", () => {
    assert.equal(classifyDeadline("2026-09-21", today), "due_soon");
  });

  test("exactly 7 days out is still due soon", () => {
    assert.equal(classifyDeadline("2026-09-28", today), "due_soon");
  });

  test("8 days out is later, not due soon", () => {
    assert.equal(classifyDeadline("2026-09-29", today), "later");
  });

  test("a date a year out is later", () => {
    assert.equal(classifyDeadline("2027-09-21", today), "later");
  });
});
