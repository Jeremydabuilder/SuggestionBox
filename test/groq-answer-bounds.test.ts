import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * The same exact-request-count proof as groq-classifier-bounds.test.ts,
 * for generateAnswerCompletion (Ask the Inbox). Kept as a fully separate
 * test file for a fully separate function, mirroring why groq.ts itself
 * duplicates rather than shares the bounded-retry implementation: a
 * passing test here says nothing about the classifier's guarantee, and a
 * regression in one can never silently hide inside the other's coverage.
 */

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function installFetchMock(responses: Array<{ status: number; body: unknown }>) {
  let callCount = 0;
  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-20b" }, { id: "llama-3.1-8b-instant" }] }), { status: 200 });
    }
    const next = responses[callCount] ?? responses[responses.length - 1]!;
    callCount += 1;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { callCount: () => callCount };
}

describe("generateAnswerCompletion — bounded request count", () => {
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

  test("a successful first call makes exactly one completion request", async () => {
    const { generateAnswerCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([{ status: 200, body: { choices: [{ message: { content: "The evidence supports this. [S001]" } }] } }]);

    const outcome = await generateAnswerCompletion("system", "user", {});
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.requestCount, 1);
  });

  test("an incompatible primary model (400) triggers exactly one fallback request, never more", async () => {
    const { generateAnswerCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([
      { status: 400, body: { error: "bad request" } },
      { status: 200, body: { choices: [{ message: { content: "Answer." } }] } },
    ]);

    const outcome = await generateAnswerCompletion("system", "user", {});
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.requestCount, 2);
  });

  test("both the primary and the single fallback being incompatible stops at 2 requests — no third model is tried", async () => {
    const { generateAnswerCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([
      { status: 422, body: { error: "unprocessable" } },
      { status: 422, body: { error: "unprocessable" } },
    ]);

    const outcome = await generateAnswerCompletion("system", "user", {});
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.requestCount, 2);
      assert.equal(outcome.errorCategory, "no_compatible_model");
    }
  });

  test("a rate limit (429) on the FIRST request is never retried with a fallback model — exactly 1 request total", async () => {
    const { generateAnswerCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([{ status: 429, body: { error: "rate limited" } }]);

    const outcome = await generateAnswerCompletion("system", "user", {});
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.requestCount, 1);
      assert.equal(outcome.errorCategory, "rate_limited");
    }
  });

  test("ANSWER_MAX_REQUESTS is exactly 2, and no test above ever exceeds it", async () => {
    const { ANSWER_MAX_REQUESTS } = await import("../src/lib/groq.ts");
    assert.equal(ANSWER_MAX_REQUESTS, 2);
  });

  test("generateAnswerCompletion does not request a JSON response_format — it returns prose, not classifier JSON", async () => {
    const groqSource = (await import("node:fs")).readFileSync(
      new URL("../src/lib/groq.ts", import.meta.url),
      "utf8",
    );
    const start = groqSource.indexOf("async function askTextModel(");
    const nextFn = groqSource.indexOf("\nexport function meetingAgentError");
    const nextTranscribe = groqSource.indexOf("\nconst GROQ_TRANSCRIPTION_ENDPOINT");
    const end = [nextFn, nextTranscribe].filter((i) => i !== -1).sort((a, b) => a - b)[0];
    const body = groqSource.slice(start, end);
    assert.doesNotMatch(body, /response_format/);
  });
});
