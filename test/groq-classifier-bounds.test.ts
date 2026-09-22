import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Proves the exact, bounded request count generateClassifierCompletion is
 * allowed to make: one request to the configured/primary model, and — only
 * on a model-incompatibility signal (400/404/422) — exactly one explicit
 * fallback. Never more than CLASSIFIER_MAX_REQUESTS (2), and never a
 * silent cycle through every candidate model the way the meeting-brief
 * path is allowed to.
 *
 * Uses a real mocked global fetch (counting calls) rather than trying to
 * hit the network — this environment has no GROQ_API_KEY, so any test
 * relying on a live call would either fail or silently no-op.
 *
 * Calls _resetGroqModelCacheForTests() in beforeEach: a dynamic
 * `import("./groq.ts?t=...")` with a different query string does NOT
 * create a fresh module instance under this project's test runner (it
 * resolves back to the same cached module), so groq.ts's module-level
 * discovered-model cache would otherwise silently carry over between
 * cases. Every test here happens to mock the same /models response, so
 * that leak was never visible — see test/groq-transcription-bounds.test.ts,
 * which varies the /models response per case and is what surfaced this.
 */

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function installFetchMock(responses: Array<{ status: number; body: unknown }>) {
  let callCount = 0;
  const calls: string[] = [];
  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-20b" }, { id: "llama-3.1-8b-instant" }] }), { status: 200 });
    }
    const next = responses[callCount] ?? responses[responses.length - 1]!;
    callCount += 1;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, callCount: () => callCount };
}

describe("generateClassifierCompletion — bounded request count", () => {
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
    const { generateClassifierCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([{ status: 200, body: { choices: [{ message: { content: '{"intent":"help","args":{},"confidence":"high"}' } }] } }]);

    const outcome = await generateClassifierCompletion("system", "user", {});
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.requestCount, 1);
  });

  test("an incompatible primary model (404) triggers exactly one fallback request, never more", async () => {
    const { generateClassifierCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([
      { status: 404, body: { error: "model not found" } },
      { status: 200, body: { choices: [{ message: { content: '{"intent":"help","args":{},"confidence":"high"}' } }] } },
    ]);

    const outcome = await generateClassifierCompletion("system", "user", {});
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.requestCount, 2);
  });

  test("both the primary and the single fallback being incompatible stops at 2 requests — no third model is tried", async () => {
    const { generateClassifierCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([
      { status: 404, body: { error: "model not found" } },
      { status: 404, body: { error: "model not found" } },
    ]);

    const outcome = await generateClassifierCompletion("system", "user", {});
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.requestCount, 2);
      assert.equal(outcome.errorCategory, "no_compatible_model");
    }
  });

  test("a rate limit (429) on the FIRST request is never retried with a fallback model — exactly 1 request total", async () => {
    const { generateClassifierCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([{ status: 429, body: { error: "rate limited" } }]);

    const outcome = await generateClassifierCompletion("system", "user", {});
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.requestCount, 1);
      assert.equal(outcome.errorCategory, "rate_limited");
    }
  });

  test("an auth failure (401) is never retried — exactly 1 request total", async () => {
    const { generateClassifierCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([{ status: 401, body: { error: "unauthorized" } }]);

    const outcome = await generateClassifierCompletion("system", "user", {});
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.requestCount, 1);
      assert.equal(outcome.errorCategory, "unauthorized");
    }
  });

  test("a rate limit on the FALLBACK request (after a 404 primary) still stops at 2 requests total", async () => {
    const { generateClassifierCompletion } = await import("../src/lib/groq.ts");
    installFetchMock([
      { status: 404, body: { error: "model not found" } },
      { status: 429, body: { error: "rate limited" } },
    ]);

    const outcome = await generateClassifierCompletion("system", "user", {});
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.requestCount, 2);
      assert.equal(outcome.errorCategory, "rate_limited");
    }
  });

  test("CLASSIFIER_MAX_REQUESTS is exactly 2, and no test above ever exceeds it", async () => {
    const { CLASSIFIER_MAX_REQUESTS } = await import("../src/lib/groq.ts");
    assert.equal(CLASSIFIER_MAX_REQUESTS, 2);
  });
});
