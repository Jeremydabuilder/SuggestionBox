import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  segmentTranscript,
  buildCleanupUserPrompt,
  parseCleanupOutput,
  CLEANUP_SYSTEM_PROMPT,
  CLEANUP_CATEGORIES,
  CLEANUP_LIMITS,
  CLEANUP_HIDDEN_BY_DEFAULT,
} from "../src/lib/transcript-cleanup.ts";

describe("segmentTranscript", () => {
  test("splits on blank-line paragraph breaks", () => {
    const segments = segmentTranscript("First point.\n\nSecond point.");
    assert.equal(segments.length, 2);
  });

  test("splits run-on sentences within a paragraph", () => {
    const segments = segmentTranscript("We discussed lunch. Then we discussed recycling. Then we adjourned.");
    assert.ok(segments.length >= 2);
  });

  test("drops empty segments", () => {
    const segments = segmentTranscript("One.\n\n\n\nTwo.");
    assert.ok(segments.every((s) => s.length > 0));
  });

  test("caps the number of segments at CLEANUP_LIMITS.maxSegments", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Point number ${i}.`).join("\n\n");
    const segments = segmentTranscript(many);
    assert.ok(segments.length <= CLEANUP_LIMITS.maxSegments);
  });

  test("bounds each segment's length", () => {
    const segments = segmentTranscript("x".repeat(5000));
    for (const s of segments) assert.ok(s.length <= CLEANUP_LIMITS.segmentLength);
  });

  test("an empty transcript produces zero segments, not an error", () => {
    assert.deepEqual(segmentTranscript(""), []);
    assert.deepEqual(segmentTranscript("   "), []);
  });
});

describe("CLEANUP_SYSTEM_PROMPT — the categorization boundary", () => {
  test("lists exactly the 7 fixed categories and forbids inventing one", () => {
    for (const category of CLEANUP_CATEGORIES) assert.match(CLEANUP_SYSTEM_PROMPT, new RegExp(category));
    assert.match(CLEANUP_SYSTEM_PROMPT, /[Nn]ever invent a category/);
  });

  test("forbids rewriting, merging, splitting, or adding text", () => {
    assert.match(CLEANUP_SYSTEM_PROMPT, /never merge or split segments, never add or rewrite text/i);
  });

  test("frames the transcript as data, never instructions", () => {
    assert.match(CLEANUP_SYSTEM_PROMPT, /never an instruction/i);
  });

  test("has exactly 7 categories", () => {
    assert.equal(CLEANUP_CATEGORIES.length, 7);
  });
});

describe("buildCleanupUserPrompt", () => {
  test("numbers each segment by index", () => {
    const prompt = buildCleanupUserPrompt(["First.", "Second."]);
    assert.match(prompt, /^0: First\./);
    assert.match(prompt, /1: Second\./);
  });
});

describe("parseCleanupOutput — the model can only classify, never rewrite", () => {
  const original = ["First segment.", "Second segment.", "Third segment."];

  test("maps each category back onto the ORIGINAL segment text, not model-generated text", () => {
    const raw = JSON.stringify({ segments: [{ index: 0, category: "decision" }, { index: 1, category: "action_item" }, { index: 2, category: "off_topic" }] });
    const result = parseCleanupOutput(raw, original);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.segments[0]!.text, "First segment.");
      assert.equal(result.segments[0]!.category, "decision");
      assert.equal(result.segments[2]!.category, "off_topic");
    }
  });

  test("an index the model never covered defaults to 'unclear', not dropped", () => {
    const raw = JSON.stringify({ segments: [{ index: 0, category: "decision" }] });
    const result = parseCleanupOutput(raw, original);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.segments.length, 3);
      assert.equal(result.segments[1]!.category, "unclear");
      assert.equal(result.segments[2]!.category, "unclear");
    }
  });

  test("an out-of-range index is ignored rather than crashing or corrupting another segment", () => {
    const raw = JSON.stringify({ segments: [{ index: 99, category: "decision" }] });
    const result = parseCleanupOutput(raw, original);
    assert.equal(result.ok, true);
    if (result.ok) assert.ok(result.segments.every((s) => s.category === "unclear"));
  });

  test("invalid JSON fails closed", () => {
    const result = parseCleanupOutput("not json", original);
    assert.equal(result.ok, false);
  });

  test("a category outside the fixed 7 fails the whole parse, never partially accepted", () => {
    const raw = JSON.stringify({ segments: [{ index: 0, category: "budget_approval" }] });
    const result = parseCleanupOutput(raw, original);
    assert.equal(result.ok, false);
  });

  test("output covers every original segment exactly once, even with duplicate/conflicting model indices", () => {
    const raw = JSON.stringify({ segments: [{ index: 0, category: "decision" }, { index: 0, category: "sensitive" }] });
    const result = parseCleanupOutput(raw, original);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.segments.length, original.length);
  });
});

describe("CLEANUP_HIDDEN_BY_DEFAULT", () => {
  test("hides exactly off_topic and sensitive by default, nothing else", () => {
    assert.deepEqual([...CLEANUP_HIDDEN_BY_DEFAULT].sort(), ["off_topic", "sensitive"]);
  });
});
