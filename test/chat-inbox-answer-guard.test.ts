import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/chat-inbox-answer.ts");

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

/**
 * The single riskiest file added in Stage 7: it is the only place a chat
 * turn sends anything to Groq that was derived from student-submitted
 * text, and the only place a model's citation of that text is trusted at
 * all. Every assertion here mirrors a specific requirement from the
 * project's citation-allowlist design, not a generic style rule.
 */
describe("chat-inbox-answer.ts — Ask the Inbox's citation-allowlist boundary", () => {
  test("is NOT a Server Action and is marked server-only — never directly callable from the browser", () => {
    assert.doesNotMatch(stripComments(source), /"use server"/);
    assert.match(source, /import\s+"server-only"/);
  });

  test("answerWorkspaceQuestion never calls getPresidentSession() itself — identity must come from the caller", () => {
    assert.doesNotMatch(stripComments(source), /getPresidentSession\(/);
  });

  test("answerWorkspaceQuestion's first parameter is an already-verified session, not a claimed identity string", () => {
    const signature = source.match(/export async function answerWorkspaceQuestion\(([^)]*)/)?.[1] ?? "";
    assert.match(signature, /session:\s*PresidentSession/);
  });

  test("calls generateAnswerCompletion exactly once per question — no loop, no unbounded retry", () => {
    const occurrences = (source.match(/generateAnswerCompletion\(/g) ?? []).length;
    assert.equal(occurrences, 1);
  });

  test("checks a per-president rate limit before ever calling Groq", () => {
    const body = functionBody("answerWorkspaceQuestion");
    const rateLimitIndex = body.indexOf("checkChatRateLimit(");
    const groqIndex = body.indexOf("generateAnswerCompletion(");
    assert.notEqual(rateLimitIndex, -1);
    assert.ok(rateLimitIndex < groqIndex);
  });

  test("every citation is validated with allCitationsAllowed before a structured card can be built", () => {
    const body = functionBody("answerWorkspaceQuestion");
    const allowlistIndex = body.indexOf("allCitationsAllowed(");
    const structuredIndex = body.indexOf("const structured: InboxAnswerStructured");
    assert.notEqual(allowlistIndex, -1);
    assert.notEqual(structuredIndex, -1);
    assert.ok(allowlistIndex < structuredIndex, "citation validation must happen before the structured card is built");
  });

  test("an answer that fails citation validation returns structured: null, never the untrusted content", () => {
    const body = functionBody("answerWorkspaceQuestion");
    const failBlock = body.match(/if \(!allCitationsAllowed\([^)]*\)\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
    assert.notEqual(failBlock, "");
    assert.match(failBlock, /structured:\s*null/);
    assert.doesNotMatch(failBlock, /content:\s*outcome\.content/);
  });

  test("only fields already in SearchableSuggestion (no student_name/student_email) are ever selected", () => {
    assert.doesNotMatch(source, /student_name|student_email/);
  });

  test("never uses the service-role client", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });

  test("evidence sent to the model is built only from the deterministic search result, never from raw question text alone", () => {
    assert.match(source, /searchInboxSuggestions\(/);
    assert.match(source, /buildInboxAnswerPrompt\(/);
  });
});
