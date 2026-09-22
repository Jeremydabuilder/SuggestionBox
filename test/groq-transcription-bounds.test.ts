import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Proves transcribeAudioBuffer's exact, honest behavior: exactly one
 * attempt when a whisper-family model is discoverable, and an immediate
 * "model_unavailable" — never a doomed request — when Groq reports no
 * whisper model at all. There is no multi-model fallback loop here the
 * way the chat/answer completions have one; Whisper-family models don't
 * have the same "wrong model name" ambiguity a chat model can.
 */

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function installFetchMock(modelsList: string[], transcriptionResponse: { status: number; body: string }) {
  const calls: string[] = [];
  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ data: modelsList.map((id) => ({ id })) }), { status: 200 });
    }
    if (url.includes("/audio/transcriptions")) {
      return new Response(transcriptionResponse.body, { status: transcriptionResponse.status });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { calls };
}

describe("transcribeAudioBuffer", () => {
  beforeEach(async () => {
    process.env.GROQ_API_KEY = "test-key-not-real";
    delete process.env.GROQ_MODEL;
    const { _resetGroqModelCacheForTests } = await import("../src/lib/groq.ts");
    _resetGroqModelCacheForTests();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  test("a successful transcription with a discoverable whisper model makes exactly one transcription request", async () => {
    const { transcribeAudioBuffer } = await import("../src/lib/groq.ts");
    const { calls } = installFetchMock(["whisper-large-v3", "openai/gpt-oss-20b"], { status: 200, body: "Hello, this is the transcript." });

    const outcome = await transcribeAudioBuffer(Buffer.from("fake-audio-bytes"), "recording.webm", "audio/webm");
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.text, "Hello, this is the transcript.");
      assert.equal(outcome.model, "whisper-large-v3");
    }
    assert.equal(calls.filter((u) => u.includes("/audio/transcriptions")).length, 1);
  });

  test("no whisper model discoverable returns model_unavailable WITHOUT ever calling the transcription endpoint", async () => {
    const { transcribeAudioBuffer } = await import("../src/lib/groq.ts");
    const { calls } = installFetchMock(["openai/gpt-oss-20b", "llama-3.1-8b-instant"], { status: 200, body: "should never be reached" });

    const outcome = await transcribeAudioBuffer(Buffer.from("fake-audio-bytes"), "recording.webm", "audio/webm");
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.errorCategory, "model_unavailable");
    assert.equal(calls.filter((u) => u.includes("/audio/transcriptions")).length, 0);
  });

  test("a rate-limited transcription request is reported, never retried with a different model", async () => {
    const { transcribeAudioBuffer } = await import("../src/lib/groq.ts");
    const { calls } = installFetchMock(["whisper-large-v3"], { status: 429, body: JSON.stringify({ error: "rate limited" }) });

    const outcome = await transcribeAudioBuffer(Buffer.from("fake-audio-bytes"), "recording.webm", "audio/webm");
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.errorCategory, "rate_limited");
    assert.equal(calls.filter((u) => u.includes("/audio/transcriptions")).length, 1);
  });

  test("an empty transcription response is treated as a failure, not a silent empty success", async () => {
    const { transcribeAudioBuffer } = await import("../src/lib/groq.ts");
    installFetchMock(["whisper-large-v3"], { status: 200, body: "   " });

    const outcome = await transcribeAudioBuffer(Buffer.from("fake-audio-bytes"), "recording.webm", "audio/webm");
    assert.equal(outcome.ok, false);
  });
});
