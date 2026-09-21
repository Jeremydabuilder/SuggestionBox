import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { boundTextForPrompt, boundTextList } from "../src/lib/text-bounds.ts";

describe("boundTextForPrompt", () => {
  test("trims, collapses whitespace, and caps length", () => {
    assert.equal(boundTextForPrompt("  hello   world  ", 100), "hello world");
    assert.equal(boundTextForPrompt("x".repeat(500), 10).length, 10);
  });

  test("strips control characters", () => {
    assert.equal(boundTextForPrompt("hello\u0000world", 100), "helloworld");
  });

  test("never throws on non-string input", () => {
    assert.equal(boundTextForPrompt(null, 10), "");
    assert.equal(boundTextForPrompt(undefined, 10), "");
    assert.equal(boundTextForPrompt(42, 10), "");
    assert.equal(boundTextForPrompt({ a: 1 }, 10), "");
  });
});

describe("boundTextList", () => {
  test("caps both item count and each item's length", () => {
    const result = boundTextList(["a".repeat(50), "b".repeat(50), "c".repeat(50), "d"], 2, 5);
    assert.equal(result.length, 2);
    assert.ok(result.every((item) => item.length <= 5));
  });

  test("drops empty items after bounding", () => {
    assert.deepEqual(boundTextList(["", "  ", "real"], 10, 100), ["real"]);
  });
});
