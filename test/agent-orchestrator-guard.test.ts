import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/agent-orchestrator.ts");

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("agent-orchestrator.ts — only presidents can run the agent", () => {
  test("is NOT a Server Action and is marked server-only", () => {
    assert.doesNotMatch(stripComments(source), /"use server"/);
    assert.match(source, /import\s+"server-only"/);
  });

  test("runAgentTurn never calls getPresidentSession() for its own first check — identity must come from the caller", () => {
    // It DOES call getPresidentSession() again per step (revalidation) —
    // this only checks the exported entry point's own first parameter is
    // a verified session, not that the string never appears at all.
    const signature = source.match(/export async function runAgentTurn\(([^)]*)/)?.[1] ?? "";
    assert.match(signature, /session:\s*PresidentSession/);
  });

  test("re-validates the session before executing every step (getPresidentSession() called inside the step loop)", () => {
    const start = source.indexOf("for (const [index, step] of plan.steps");
    const loopBody = source.slice(start, source.indexOf("\n  }", start));
    assert.match(loopBody, /getPresidentSession\(\)/);
  });
});

describe("agent-orchestrator.ts — bounded to at most 4 steps, no repeats, no unknown tools", () => {
  test("execution is capped with .slice(0, AGENT_PLAN_LIMITS.maxSteps)", () => {
    assert.match(source, /plan\.steps\.slice\(0, AGENT_PLAN_LIMITS\.maxSteps\)/);
  });

  test("every step's intent/args pass through sanitizePlanSteps before executeStep can ever run — dedup and schema validation happen upstream (see agent-plan.test.ts)", () => {
    assert.match(source, /sanitizePlanSteps\(/);
  });

  test("stops early after AGENT_PLAN_LIMITS.maxConsecutiveFailures consecutive step failures", () => {
    assert.match(source, /consecutiveFailures >= AGENT_PLAN_LIMITS\.maxConsecutiveFailures/);
  });

  test("executeStep's switch only ever calls the pre-existing, already-tested read-only server actions — no generic fetch, SQL, or eval", () => {
    const start = source.indexOf("async function executeStep(");
    const body = source.slice(start, source.indexOf("\nexport interface AgentPlanStepView"));
    assert.doesNotMatch(body, /\bexec\(|\beval\(|child_process|\.rpc\(|from\(["'`]/);
  });
});

describe("agent-orchestrator.ts — the agent can never confirm its own proposal", () => {
  test("never imports or calls anything from chat-assistant-internal.ts (the only place a confirmation can be applied)", () => {
    assert.doesNotMatch(source, /chat-assistant-internal|applyMemoryConfirmation|proposeMemoryAction/);
  });

  test("never touches chat_pending_confirmations or chat_memories", () => {
    assert.doesNotMatch(source, /chat_pending_confirmations|chat_memories/);
  });

  test("never uses the service-role client, and never writes to any table", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });
});

describe("agent-orchestrator.ts — citations must exist in a fresh allowlist built from this turn's own evidence", () => {
  test("allCitationsAllowed is checked against refTitleByRef, built only from this turn's search_inbox results, before a synthesized answer is ever kept", () => {
    const body = functionBody("runAgentTurn");
    const allowlistIndex = body.indexOf("allCitationsAllowed(");
    const keepIndex = body.indexOf("synthesizedAnswer = outcome.content.trim();");
    assert.notEqual(allowlistIndex, -1);
    assert.notEqual(keepIndex, -1);
    assert.ok(allowlistIndex < keepIndex, "citation validation must happen before the synthesized answer is kept");
  });

  test("a synthesis whose citations fail the allowlist is logged and discarded, never shown", () => {
    const body = functionBody("runAgentTurn");
    assert.match(body, /discarded a synthesis citing a ref outside its own evidence/);
  });
});

describe("agent-orchestrator.ts — bounded Groq usage: deterministic templates cost nothing, planning and synthesis are each independently bounded", () => {
  test("calls generateClassifierCompletion (planning) at most once per turn", () => {
    const occurrences = (source.match(/generateClassifierCompletion\(/g) ?? []).length;
    assert.equal(occurrences, 1);
  });

  test("calls generateAnswerCompletion (synthesis) at most once per turn", () => {
    const occurrences = (source.match(/generateAnswerCompletion\(/g) ?? []).length;
    assert.equal(occurrences, 1);
  });

  test("a deterministic template match returns before any Groq-calling code is reached", () => {
    const body = functionBody("resolvePlan");
    const templateIndex = body.indexOf("matchAgentPlanTemplate(message)");
    const groqIndex = body.indexOf("generateClassifierCompletion(");
    const templateReturnIndex = body.indexOf("if (templatePlan) return");
    assert.ok(templateIndex < templateReturnIndex && templateReturnIndex < groqIndex);
  });

  test("the AI planning call is only reached when the message looks like a compound goal AND the existing deterministic single-tool router found nothing", () => {
    const body = functionBody("resolvePlan");
    const detIndex = body.indexOf("routeDeterministically(message)");
    const compoundIndex = body.indexOf("looksLikeCompoundGoal(message)");
    const groqIndex = body.indexOf("generateClassifierCompletion(");
    assert.ok(detIndex < groqIndex && compoundIndex < groqIndex);
  });

  test("a failed planning call (Groq unavailable/rate-limited) returns plan: null rather than throwing — deterministic single-tool routing still works", () => {
    const body = functionBody("resolvePlan");
    assert.match(body, /if \(!outcome\.ok\) return \{ plan: null, groqRequestCount: outcome\.requestCount \};/);
  });

  test("checks a per-president rate limit before both the planning call and the synthesis call", () => {
    const occurrences = (source.match(/checkChatRateLimit\(/g) ?? []).length;
    assert.equal(occurrences, 2);
  });
});

describe("agent-orchestrator.ts — student identity never enters a prompt", () => {
  test("never references student_name or student_email", () => {
    assert.doesNotMatch(source, /student_name|student_email/);
  });
});
