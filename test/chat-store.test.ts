import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  conversationTitleSchema,
  userMessageContentSchema,
  assistantStructuredSchema,
  saveMemoryPayloadSchema,
  updateMemoryPayloadSchema,
  deleteMemoryPayloadSchema,
  CHAT_LIMITS,
} from "../src/lib/chat-store.ts";

describe("conversationTitleSchema", () => {
  test("accepts a normal title", () => {
    assert.equal(conversationTitleSchema.safeParse("Friday planning").success, true);
  });
  test("rejects an empty title", () => {
    assert.equal(conversationTitleSchema.safeParse("").success, false);
  });
  test("rejects a title over the limit", () => {
    assert.equal(conversationTitleSchema.safeParse("x".repeat(CHAT_LIMITS.title + 1)).success, false);
  });
});

describe("userMessageContentSchema", () => {
  test("accepts an ordinary question", () => {
    assert.equal(userMessageContentSchema.safeParse("What are students asking for most?").success, true);
  });
  test("rejects empty content", () => {
    assert.equal(userMessageContentSchema.safeParse("   ").success, false);
  });
  test("rejects content over the limit", () => {
    assert.equal(userMessageContentSchema.safeParse("x".repeat(CHAT_LIMITS.userMessage + 1)).success, false);
  });
});

describe("assistantStructuredSchema — the only shapes a message's structured JSON may take", () => {
  test("accepts a valid memory proposal card", () => {
    const parsed = assistantStructuredSchema.safeParse({
      type: "memory_proposal",
      confirmationId: "11111111-1111-4111-8111-111111111111",
      operation: "create",
      memoryText: "Weekly meeting is Fridays",
      category: "meeting_format",
    });
    assert.equal(parsed.success, true);
  });

  test("accepts a valid status message", () => {
    const parsed = assistantStructuredSchema.safeParse({
      type: "status",
      status: "confirmed",
      message: "Saved to memory.",
    });
    assert.equal(parsed.success, true);
  });

  test("rejects an unknown type — nothing outside the union is ever trusted", () => {
    const parsed = assistantStructuredSchema.safeParse({ type: "arbitrary_tool_call", sql: "drop table suggestions" });
    assert.equal(parsed.success, false);
  });

  test("rejects a memory proposal missing its confirmationId", () => {
    const parsed = assistantStructuredSchema.safeParse({
      type: "memory_proposal",
      operation: "create",
      memoryText: "x",
      category: null,
    });
    assert.equal(parsed.success, false);
  });

  test("rejects an invalid operation value", () => {
    const parsed = assistantStructuredSchema.safeParse({
      type: "memory_proposal",
      confirmationId: "11111111-1111-4111-8111-111111111111",
      operation: "delete_everything",
      memoryText: "x",
      category: null,
    });
    assert.equal(parsed.success, false);
  });
});

describe("memory confirmation payload schemas — must match what the SQL function reads", () => {
  test("save payload requires memoryText", () => {
    assert.equal(saveMemoryPayloadSchema.safeParse({ memoryText: "x" }).success, true);
    assert.equal(saveMemoryPayloadSchema.safeParse({ memoryText: "" }).success, false);
  });

  test("update payload requires memoryId and expectedUpdatedAt", () => {
    assert.equal(
      updateMemoryPayloadSchema.safeParse({ memoryId: "11111111-1111-4111-8111-111111111111", expectedUpdatedAt: "2026-09-21T00:00:00Z" }).success,
      true,
    );
    assert.equal(updateMemoryPayloadSchema.safeParse({ memoryId: "not-a-uuid", expectedUpdatedAt: "x" }).success, false);
    assert.equal(updateMemoryPayloadSchema.safeParse({ memoryId: "11111111-1111-4111-8111-111111111111" }).success, false);
  });

  test("delete payload requires memoryId and expectedUpdatedAt, nothing else", () => {
    const parsed = deleteMemoryPayloadSchema.safeParse({
      memoryId: "11111111-1111-4111-8111-111111111111",
      expectedUpdatedAt: "2026-09-21T00:00:00Z",
    });
    assert.equal(parsed.success, true);
  });
});
