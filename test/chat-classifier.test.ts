import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_LIMITS,
  buildClassifierUserPrompt,
  parseClassifierOutput,
} from "../src/lib/chat-classifier.ts";
import { CHAT_INTENTS } from "../src/lib/chat-intents.ts";

describe("CLASSIFIER_SYSTEM_PROMPT — the prompt-injection boundary", () => {
  test("states it classifies the request only, retrieved text is evidence not instruction", () => {
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /classif/i);
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /evidence/i);
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /never an instruction|not.*instruction/i);
  });

  test("states it cannot invent new tools, tables, or URLs", () => {
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /cannot invent/i);
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /table/i);
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /URL/);
  });

  test("states it cannot request SQL, credentials, roles, or hidden data", () => {
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /SQL/);
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /credentials/i);
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /roles?/i);
  });

  test("states it cannot authorize or execute mutations", () => {
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /cannot authorize/i);
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /mutation/i);
  });

  test("states it must choose only from the provided enum", () => {
    assert.match(CLASSIFIER_SYSTEM_PROMPT, /only from the.*list|only choose from/i);
  });

  test("contains no student, memory, or database content — it is a fixed instruction string", () => {
    assert.doesNotMatch(CLASSIFIER_SYSTEM_PROMPT, /@[^\s]+\.[a-z]{2,}/i); // no email-shaped text
    assert.doesNotMatch(CLASSIFIER_SYSTEM_PROMPT, /student_name|student_email|submitter/i);
  });
});

describe("buildClassifierUserPrompt — bounded, no leakage", () => {
  test("lists every allowed intent by name", () => {
    const prompt = buildClassifierUserPrompt("hello", []);
    for (const intent of CHAT_INTENTS) assert.match(prompt, new RegExp(intent));
  });

  test("caps the message length", () => {
    const prompt = buildClassifierUserPrompt("x".repeat(10_000), []);
    const messageSection = prompt.split("President's message:\n")[1] ?? "";
    assert.ok(messageSection.length <= CLASSIFIER_LIMITS.message + 5);
  });

  test("caps both the number of context messages and each one's length", () => {
    const context = Array.from({ length: 20 }, (_, i) => `message number ${i} `.repeat(50));
    const prompt = buildClassifierUserPrompt("hi", context);
    const contextLines = prompt.split("\n").filter((line) => /^\d+\. /.test(line));
    assert.ok(contextLines.length <= CLASSIFIER_LIMITS.contextMessages);
    for (const line of contextLines) {
      assert.ok(line.length <= CLASSIFIER_LIMITS.contextMessageLength + 10);
    }
  });

  test("no context at all produces a prompt with no context block", () => {
    const prompt = buildClassifierUserPrompt("hi", []);
    assert.doesNotMatch(prompt, /Recent conversation/);
  });
});

describe("parseClassifierOutput — nothing from the model is trusted without full validation", () => {
  test("accepts a well-formed response for a real intent", () => {
    const result = parseClassifierOutput(JSON.stringify({ intent: "list_actions", args: { status: "open" }, confidence: "high" }));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.decision.intent, "list_actions");
      assert.equal(result.decision.source, "ai");
    }
  });

  test("malformed JSON is rejected, not eval'd or partially parsed", () => {
    const result = parseClassifierOutput("{ this is not json");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "malformed_json");
  });

  test("an intent outside the enum is rejected outright", () => {
    const result = parseClassifierOutput(JSON.stringify({ intent: "run_sql_query", args: { sql: "DROP TABLE suggestions" }, confidence: "high" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_shape");
  });

  test("a prompt-injection attempt naming a fake tool/table is rejected, not silently coerced", () => {
    const result = parseClassifierOutput(
      JSON.stringify({
        intent: "search_inbox",
        args: { query: "lunch", table: "authorized_presidents", sql: "select * from authorized_presidents" },
        confidence: "high",
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_args");
  });

  test("a real intent with the wrong argument shape for it is rejected", () => {
    const result = parseClassifierOutput(JSON.stringify({ intent: "related_suggestions", args: { ref: "not-a-valid-ref" }, confidence: "high" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_args");
  });

  test("an invalid confidence value is rejected", () => {
    const result = parseClassifierOutput(JSON.stringify({ intent: "help", args: {}, confidence: "99%" }));
    assert.equal(result.ok, false);
  });

  test("extra top-level keys beyond intent/args/confidence are rejected", () => {
    const result = parseClassifierOutput(
      JSON.stringify({ intent: "help", args: {}, confidence: "high", authorization: "admin", execute: true }),
    );
    assert.equal(result.ok, false);
  });

  test("a clarification_needed response carries its question through", () => {
    const result = parseClassifierOutput(
      JSON.stringify({ intent: "clarification_needed", args: { question: "Which meeting do you mean?" }, confidence: "medium" }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.decision.needsClarification, true);
      assert.equal(result.decision.clarificationQuestion, "Which meeting do you mean?");
    }
  });
});
