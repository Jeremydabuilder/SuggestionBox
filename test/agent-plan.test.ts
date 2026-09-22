import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_PLANNABLE_INTENTS,
  AGENT_PLAN_LIMITS,
  AGENT_STEP_LABELS,
  isPlannableIntent,
  sanitizePlanSteps,
} from "../src/lib/agent-plan.ts";

describe("AGENT_PLANNABLE_INTENTS — the closed, mutation-free tool set", () => {
  test("excludes every confirmation_required or Groq-calling-as-a-step intent", () => {
    for (const excluded of ["memory_manager", "meeting_cleanup", "general_workspace_question", "proposal_builder", "draft_communication", "help", "clarification_needed"]) {
      assert.equal(isPlannableIntent(excluded), false, `${excluded} must not be plannable`);
    }
  });

  test("every listed intent has a fixed, human-written status label", () => {
    for (const intent of AGENT_PLANNABLE_INTENTS) {
      assert.equal(typeof AGENT_STEP_LABELS[intent], "string");
      assert.ok(AGENT_STEP_LABELS[intent].length > 0);
    }
  });

  test("isPlannableIntent rejects an arbitrary string", () => {
    assert.equal(isPlannableIntent("drop_table_suggestions"), false);
  });
});

describe("sanitizePlanSteps — the last line of defense before any step runs", () => {
  test("passes through valid steps unchanged", () => {
    const steps = sanitizePlanSteps([
      { intent: "search_inbox", args: { query: "lunch" } },
      { intent: "trend_radar", args: {} },
    ]);
    assert.equal(steps.length, 2);
    assert.equal(steps[0]!.intent, "search_inbox");
  });

  test("caps at AGENT_PLAN_LIMITS.maxSteps even when more are given", () => {
    const many = Array.from({ length: 10 }, () => ({ intent: "trend_radar", args: {} }));
    const steps = sanitizePlanSteps(many);
    // also deduped to 1 since they're all the same intent, but never exceeds the cap either way
    assert.ok(steps.length <= AGENT_PLAN_LIMITS.maxSteps);
  });

  test("drops a repeated intent, keeping only the first occurrence", () => {
    const steps = sanitizePlanSteps([
      { intent: "search_inbox", args: { query: "a" } },
      { intent: "search_inbox", args: { query: "b" } },
    ]);
    assert.equal(steps.length, 1);
    assert.equal((steps[0]!.args as { query?: string }).query, "a");
  });

  test("drops an intent outside AGENT_PLANNABLE_INTENTS, even a real ChatIntent", () => {
    const steps = sanitizePlanSteps([{ intent: "memory_manager", args: {} }]);
    assert.deepEqual(steps, []);
  });

  test("drops an intent that isn't a ChatIntent at all — no crash, no forgery", () => {
    const steps = sanitizePlanSteps([{ intent: "run_sql", args: { sql: "DROP TABLE suggestions" } }]);
    assert.deepEqual(steps, []);
  });

  test("drops a step whose args fail that intent's own strict schema", () => {
    const steps = sanitizePlanSteps([{ intent: "search_inbox", args: { query: "ok", sql: "DROP TABLE suggestions" } }]);
    assert.deepEqual(steps, []);
  });

  test("drops a step whose args have the wrong type for a valid field", () => {
    const steps = sanitizePlanSteps([{ intent: "list_actions", args: { status: "not_a_real_status" } }]);
    assert.deepEqual(steps, []);
  });

  test("an empty input produces an empty plan, not an error", () => {
    assert.deepEqual(sanitizePlanSteps([]), []);
  });

  test("missing args defaults to an empty object rather than throwing", () => {
    const steps = sanitizePlanSteps([{ intent: "trend_radar", args: undefined }]);
    assert.equal(steps.length, 1);
  });
});
