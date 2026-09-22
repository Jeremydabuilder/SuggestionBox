import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_PLAN_SYSTEM_PROMPT, buildAgentPlanUserPrompt, AGENT_PLAN_LIMITS } from "../src/lib/agent-plan-prompt.ts";
import { AGENT_PLANNABLE_INTENTS } from "../src/lib/agent-plan.ts";

describe("AGENT_PLAN_SYSTEM_PROMPT", () => {
  test("names every plannable intent and forbids inventing one outside the list", () => {
    for (const intent of AGENT_PLANNABLE_INTENTS) assert.match(AGENT_PLAN_SYSTEM_PROMPT, new RegExp(intent));
    assert.match(AGENT_PLAN_SYSTEM_PROMPT, /[Nn]ever invent a tool name/);
  });

  test("forbids SQL, a URL, or a table/file path anywhere in the output", () => {
    assert.match(AGENT_PLAN_SYSTEM_PROMPT, /SQL/);
    assert.match(AGENT_PLAN_SYSTEM_PROMPT, /URL/);
  });

  test("caps steps at 4 by naming it explicitly", () => {
    assert.match(AGENT_PLAN_SYSTEM_PROMPT, /up to 4/);
  });
});

describe("buildAgentPlanUserPrompt", () => {
  test("bounds the message length even if the caller forgets to", () => {
    const prompt = buildAgentPlanUserPrompt("x".repeat(5000));
    assert.ok(prompt.length <= AGENT_PLAN_LIMITS.message + "Request: ".length);
  });

  test("includes the request text", () => {
    assert.match(buildAgentPlanUserPrompt("prepare for the meeting"), /prepare for the meeting/);
  });
});
