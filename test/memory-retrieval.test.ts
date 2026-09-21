import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rankMemories, selectRelevantMemories, tokenize } from "../src/lib/memory-retrieval.ts";
import type { Memory } from "../src/lib/chat-store.ts";

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "id-1",
    memoryText: "Weekly meeting is Fridays at 3pm",
    category: "meeting_format",
    createdBy: "prez@school.org",
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedBy: "prez@school.org",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("tokenize", () => {
  test("lowercases, strips punctuation, and drops stopwords", () => {
    assert.deepEqual(tokenize("The Weekly Meeting is on Fridays!"), ["weekly", "meeting", "fridays"]);
  });

  test("drops single-character tokens", () => {
    assert.deepEqual(tokenize("a b cd"), ["cd"]);
  });
});

describe("rankMemories — deterministic, zero-AI ranking", () => {
  test("a memory matching the query ranks above one that doesn't", () => {
    const memories = [
      memory({ id: "a", memoryText: "Weekly meeting is Fridays at 3pm" }),
      memory({ id: "b", memoryText: "Prefer a short, three-item agenda" }),
    ];
    const ranked = rankMemories(memories, "when is the weekly meeting");
    assert.equal(ranked[0]!.memory.id, "a");
  });

  test("a rarer shared word outweighs a common one appearing in every memory", () => {
    const memories = [
      memory({ id: "common", memoryText: "meeting meeting meeting" }),
      memory({ id: "rare", memoryText: "meeting assembly" }),
    ];
    // "assembly" appears in only one memory, so a query naming it should
    // still be able to distinguish that memory from a repeat of the shared word.
    const ranked = rankMemories(memories, "assembly meeting");
    assert.equal(ranked[0]!.memory.id, "rare");
  });

  test("an empty or all-stopword query returns nothing", () => {
    const memories = [memory()];
    assert.deepEqual(rankMemories(memories, ""), []);
    assert.deepEqual(rankMemories(memories, "the a an"), []);
  });

  test("a memory with no overlapping tokens is excluded, not scored zero and kept", () => {
    const memories = [memory({ memoryText: "Completely unrelated content here" })];
    assert.deepEqual(rankMemories(memories, "weekly meeting fridays"), []);
  });
});

describe("selectRelevantMemories — caps, never a full-history dump", () => {
  test("never returns more than maxCount even when everything matches", () => {
    const memories = Array.from({ length: 20 }, (_, i) => memory({ id: `m${i}`, memoryText: `meeting note number ${i}` }));
    const selected = selectRelevantMemories(memories, "meeting", { maxCount: 3, maxTotalChars: 10_000 });
    assert.equal(selected.length, 3);
  });

  test("stops before exceeding the character budget", () => {
    const memories = [
      memory({ id: "a", memoryText: "meeting ".repeat(50) }), // long
      memory({ id: "b", memoryText: "meeting short" }),
    ];
    const selected = selectRelevantMemories(memories, "meeting", { maxCount: 10, maxTotalChars: 50 });
    // The long one alone already exceeds the budget; it's still included
    // (never return zero results for a real match), but nothing after it is.
    assert.equal(selected.length, 1);
  });

  test("an irrelevant memory store returns an empty list, not a fallback dump", () => {
    const memories = [memory({ memoryText: "Something entirely unrelated" })];
    assert.deepEqual(selectRelevantMemories(memories, "budget proposal costs"), []);
  });
});
