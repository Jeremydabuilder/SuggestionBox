import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_DEFAULT_NAME,
  AGENT_NAME_MEMORY_PREFIX,
  agentNameMemoryText,
  isAgentNameMemory,
  isValidAgentName,
  resolveAgentName,
  findAgentNameMemory,
} from "../src/lib/agent-identity.ts";

describe("agent name memory convention", () => {
  test("agentNameMemoryText/isAgentNameMemory round-trip", () => {
    const text = agentNameMemoryText("Atlas");
    assert.equal(text, "Agent name: Atlas");
    assert.equal(isAgentNameMemory(text), true);
  });

  test("an ordinary memory is never mistaken for an agent-name memory", () => {
    assert.equal(isAgentNameMemory("Weekly meeting is Fridays at 3pm"), false);
  });
});

describe("isValidAgentName", () => {
  test("accepts a short single-line name", () => {
    assert.equal(isValidAgentName("Atlas"), true);
  });

  test("rejects an empty name", () => {
    assert.equal(isValidAgentName(""), false);
  });

  test("rejects a name over the max length", () => {
    assert.equal(isValidAgentName("x".repeat(41)), false);
  });

  test("rejects a multi-line name", () => {
    assert.equal(isValidAgentName("Atlas\nEvil"), false);
  });
});

describe("resolveAgentName", () => {
  test("falls back to AGENT_DEFAULT_NAME with no agent-name memory", () => {
    assert.equal(resolveAgentName([]), AGENT_DEFAULT_NAME);
    assert.equal(
      resolveAgentName([{ memoryText: "Weekly meeting is Fridays", updatedAt: "2026-01-01T00:00:00.000Z" }]),
      AGENT_DEFAULT_NAME,
    );
  });

  test("uses the confirmed name when one exists", () => {
    const resolved = resolveAgentName([
      { memoryText: agentNameMemoryText("Atlas"), updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    assert.equal(resolved, "Atlas");
  });

  test("the most recently updated agent-name memory wins on a rename", () => {
    const resolved = resolveAgentName([
      { memoryText: agentNameMemoryText("Old Name"), updatedAt: "2026-01-01T00:00:00.000Z" },
      { memoryText: agentNameMemoryText("New Name"), updatedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    assert.equal(resolved, "New Name");
  });

  test("an invalid stored candidate (should never happen, but fails closed) falls back to the default", () => {
    const resolved = resolveAgentName([{ memoryText: `${AGENT_NAME_MEMORY_PREFIX}`, updatedAt: "2026-01-01T00:00:00.000Z" }]);
    assert.equal(resolved, AGENT_DEFAULT_NAME);
  });
});

describe("findAgentNameMemory", () => {
  test("returns null when none exists", () => {
    assert.equal(findAgentNameMemory([]), null);
  });

  test("returns the latest one for an edit-in-place proposal", () => {
    const older = { id: "a", memoryText: agentNameMemoryText("Old"), updatedAt: "2026-01-01T00:00:00.000Z" };
    const newer = { id: "b", memoryText: agentNameMemoryText("New"), updatedAt: "2026-02-01T00:00:00.000Z" };
    const found = findAgentNameMemory([older, newer]);
    assert.equal(found?.id, "b");
  });
});
