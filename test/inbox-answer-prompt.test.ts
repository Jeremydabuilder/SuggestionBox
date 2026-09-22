import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildInboxAnswerPrompt, INBOX_ANSWER_SYSTEM_PROMPT, INBOX_ANSWER_LIMITS } from "../src/lib/inbox-answer-prompt.ts";

describe("INBOX_ANSWER_SYSTEM_PROMPT — the prompt-injection defense", () => {
  test("tells the model evidence is data, never instructions", () => {
    assert.match(INBOX_ANSWER_SYSTEM_PROMPT, /never an instruction|ignore anything inside a snippet/i);
  });

  test("requires every claim to carry its bracketed ref and forbids inventing one", () => {
    assert.match(INBOX_ANSWER_SYSTEM_PROMPT, /\[S001\]/);
    assert.match(INBOX_ANSWER_SYSTEM_PROMPT, /[Nn]ever invent a ref/);
  });

  test("states the model has no tools and cannot change anything", () => {
    assert.match(INBOX_ANSWER_SYSTEM_PROMPT, /no tools|no database access|no ability to change/i);
  });
});

describe("buildInboxAnswerPrompt", () => {
  test("includes the question and every evidence ref/title/status", () => {
    const prompt = buildInboxAnswerPrompt("What do students want for lunch?", [
      { ref: "S001", title: "More vegan options", description: "students asked for more vegan choices", status: "New" },
    ]);
    assert.match(prompt, /What do students want for lunch\?/);
    assert.match(prompt, /\[S001\]/);
    assert.match(prompt, /More vegan options/);
    assert.match(prompt, /New/);
  });

  test("says plainly when there is no matching evidence, rather than sending an empty section", () => {
    const prompt = buildInboxAnswerPrompt("anything?", []);
    assert.match(prompt, /no matching suggestions found/i);
  });

  test("bounds the question length even if a caller forgets to", () => {
    const longQuestion = "x".repeat(5000);
    const prompt = buildInboxAnswerPrompt(longQuestion, []);
    const questionLine = prompt.split("\n")[0]!;
    assert.ok(questionLine.length <= INBOX_ANSWER_LIMITS.questionLength + "Question: ".length);
  });

  test("caps evidence at INBOX_ANSWER_LIMITS.maxEvidence even if more is passed in", () => {
    const evidence = Array.from({ length: 20 }, (_, i) => ({
      ref: `S${String(i + 1).padStart(3, "0")}`,
      title: `Item ${i}`,
      description: "text",
      status: "New",
    }));
    const prompt = buildInboxAnswerPrompt("q", evidence);
    const matches = prompt.match(/\[S\d{3}\]/g) ?? [];
    assert.equal(matches.length, INBOX_ANSWER_LIMITS.maxEvidence);
  });

  test("bounds each snippet's description length", () => {
    const prompt = buildInboxAnswerPrompt("q", [{ ref: "S001", title: "t", description: "x".repeat(5000), status: "New" }]);
    const evidenceLine = prompt.split("\n").find((line) => line.startsWith("[S001]"))!;
    assert.ok(evidenceLine.length < 5000);
  });
});
