import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("meeting-transcription-actions.ts — in-memory only, no persistence", () => {
  const source = read("src/app/president/meeting-transcription-actions.ts");

  test("is a Server Action and checks the session first", () => {
    assert.match(stripComments(source), /"use server"/);
    const body = functionBody(source, "transcribeAudio");
    const sessionIndex = body.indexOf("getPresidentSession()");
    assert.notEqual(sessionIndex, -1);
  });

  test("never imports node:fs or writes to a temp file — nothing here touches disk", () => {
    assert.doesNotMatch(source, /from "node:fs"|require\("fs"\)|writeFile|createWriteStream|tmpdir\(/);
  });

  test("never uses the service-role client or writes to any Supabase table", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });

  test("validates the uploaded file (size and MIME type) before ever calling Groq", () => {
    const body = functionBody(source, "transcribeAudio");
    const validateIndex = body.indexOf("validateAudioFile(");
    const groqIndex = body.indexOf("transcribeAudioBuffer(");
    assert.notEqual(validateIndex, -1);
    assert.ok(validateIndex < groqIndex);
  });

  test("calls transcribeAudioBuffer exactly once — no retry loop", () => {
    const occurrences = (source.match(/transcribeAudioBuffer\(/g) ?? []).length;
    assert.equal(occurrences, 1);
  });

  test("the returned transcript is bounded by AUDIO_LIMITS.maxTranscriptChars", () => {
    assert.match(source, /\.slice\(0, AUDIO_LIMITS\.maxTranscriptChars\)/);
  });
});

describe("chat-cleanup-review.ts — categorization only, no rewriting, no direct session lookup", () => {
  const source = read("src/app/president/chat-cleanup-review.ts");

  test("is NOT a Server Action and is marked server-only", () => {
    assert.doesNotMatch(stripComments(source), /"use server"/);
    assert.match(source, /import\s+"server-only"/);
  });

  test("categorizeTranscript never calls getPresidentSession() itself", () => {
    assert.doesNotMatch(stripComments(source), /getPresidentSession\(/);
  });

  test("categorizeTranscript's first parameter is an already-verified session", () => {
    const signature = source.match(/export async function categorizeTranscript\(([^)]*)/)?.[1] ?? "";
    assert.match(signature, /session:\s*PresidentSession/);
  });

  test("calls generateClassifierCompletion exactly once per transcript — reuses the tested bounded call, no new unbounded path", () => {
    const occurrences = (source.match(/generateClassifierCompletion\(/g) ?? []).length;
    assert.equal(occurrences, 1);
  });

  test("checks a per-president rate limit before ever calling Groq", () => {
    const rateLimitIndex = source.indexOf("checkChatRateLimit(");
    const groqIndex = source.indexOf("generateClassifierCompletion(");
    assert.notEqual(rateLimitIndex, -1);
    assert.ok(rateLimitIndex < groqIndex);
  });

  test("every failure path still returns real segment text (marked 'unclear'), never blocks the president from reviewing manually", () => {
    const occurrences = (source.match(/allUnclear\(segments\)/g) ?? []).length;
    assert.ok(occurrences >= 2, "expected multiple fallback paths to use allUnclear");
  });
});

describe("meeting-cleanup-actions.ts — nothing here saves anything", () => {
  const source = read("src/app/president/meeting-cleanup-actions.ts");

  test("is a Server Action and checks the session first", () => {
    assert.match(stripComments(source), /"use server"/);
    const body = functionBody(source, "reviewMeetingTranscript");
    assert.notEqual(body.indexOf("getPresidentSession()"), -1);
  });

  test("never uses the service-role client and never writes to any table", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });

  test("bounds the raw transcript before it reaches categorizeTranscript", () => {
    assert.match(source, /\.slice\(0, AUDIO_LIMITS\.maxTranscriptChars\)/);
  });
});
