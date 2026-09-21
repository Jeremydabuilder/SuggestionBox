import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkChatRateLimit, _resetChatRateLimitsForTests } from "../src/lib/chat-rate-limit.ts";

describe("checkChatRateLimit", () => {
  beforeEach(() => {
    _resetChatRateLimitsForTests();
  });

  test("allows requests under the max", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(checkChatRateLimit("key-a", 3, 60_000).allowed, true);
    }
  });

  test("blocks once the max within the window is reached", () => {
    for (let i = 0; i < 3; i++) checkChatRateLimit("key-b", 3, 60_000);
    const result = checkChatRateLimit("key-b", 3, 60_000);
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterSeconds > 0);
  });

  test("different keys are independent", () => {
    for (let i = 0; i < 3; i++) checkChatRateLimit("key-c", 3, 60_000);
    assert.equal(checkChatRateLimit("key-d", 3, 60_000).allowed, true);
  });

  test("an old entry outside the window no longer counts", () => {
    // Use a zero-width window so every prior entry is immediately "outside" it.
    checkChatRateLimit("key-e", 1, 0);
    const result = checkChatRateLimit("key-e", 1, 0);
    assert.equal(result.allowed, true);
  });
});
