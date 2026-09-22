import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { matchAgentPlanTemplate, looksLikeCompoundGoal } from "../src/lib/agent-plan-templates.ts";

describe("matchAgentPlanTemplate — the documented example", () => {
  test("\"Prepare us for Friday's meeting and focus on lunch\" builds the exact 4-step plan", () => {
    const plan = matchAgentPlanTemplate("Prepare us for Friday's meeting and focus on lunch");
    assert.notEqual(plan, null);
    assert.equal(plan!.source, "template");
    assert.equal(plan!.needsSynthesis, false);
    assert.deepEqual(
      plan!.steps.map((s) => s.intent),
      ["search_inbox", "trend_radar", "promise_tracker", "meeting_prep"],
    );
    assert.equal((plan!.steps[0]!.args as { query?: string }).query, "lunch");
  });

  test("a plain 'prepare our next meeting' with no topic does not match this template (the existing single-intent router already handles it)", () => {
    assert.equal(matchAgentPlanTemplate("Prepare our next meeting"), null);
  });

  test("\"find the biggest student concern\" builds a synthesis-needed plan", () => {
    const plan = matchAgentPlanTemplate("find the biggest student concern");
    assert.notEqual(plan, null);
    assert.equal(plan!.needsSynthesis, true);
    assert.ok(plan!.steps.length > 0);
    assert.ok(plan!.steps.every((s) => ["trend_radar", "search_inbox", "promise_tracker"].includes(s.intent)));
  });

  test("ordinary conversational text matches nothing", () => {
    assert.equal(matchAgentPlanTemplate("thanks, that was helpful"), null);
  });

  test("an empty message matches nothing", () => {
    assert.equal(matchAgentPlanTemplate(""), null);
    assert.equal(matchAgentPlanTemplate("   "), null);
  });
});

describe("looksLikeCompoundGoal — the gate on the one allowed AI planning call", () => {
  test("a message naming two domain terms joined by 'and' looks compound", () => {
    assert.equal(looksLikeCompoundGoal("check the decisions and the action items"), true);
  });

  test("a message naming two domain terms joined by 'then' looks compound", () => {
    assert.equal(looksLikeCompoundGoal("review the inbox then draft an update"), true);
  });

  test("a single-topic message never looks compound, even with 'and' in it", () => {
    assert.equal(looksLikeCompoundGoal("show me suggestions about food and drinks"), false);
  });

  test("a plain single-tool message never looks compound", () => {
    assert.equal(looksLikeCompoundGoal("show open action items"), false);
  });
});
