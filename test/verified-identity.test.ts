import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { suggestionSchema } from "../src/lib/validation.ts";
import { sanitizeLine } from "../src/lib/sanitize.ts";

const BASE = {
  title: "Better lunch options",
  description: "Please add more vegetarian choices during lunch every day of the week.",
  category: "food" as const,
  improvementReason: "More students could find something they enjoy eating.",
};

describe("suggestion submission schema — verified identity only", () => {
  test("accepts a submission with a name", () => {
    const parsed = suggestionSchema.safeParse({ ...BASE, studentName: "Jordan R." });
    assert.equal(parsed.success, true);
  });

  test("rejects a missing name", () => {
    const parsed = suggestionSchema.safeParse({ ...BASE, studentName: "" });
    assert.equal(parsed.success, false);
  });

  test("rejects a name that is only whitespace, as the API route actually sees it", () => {
    // The route runs sanitizeLine() (which trims) before this schema ever
    // sees the value — this reproduces that exact pipeline.
    const cleaned = sanitizeLine("   ", 80);
    const parsed = suggestionSchema.safeParse({ ...BASE, studentName: cleaned });
    assert.equal(parsed.success, false);
  });

  test("the schema has no isAnonymous or studentEmail field to forge", () => {
    // A client can no longer choose anonymity or supply its own email — the
    // schema simply does not define those keys, so anything sent under them
    // is ignored rather than trusted.
    const shape = suggestionSchema.shape as Record<string, unknown>;
    assert.equal("isAnonymous" in shape, false);
    assert.equal("studentEmail" in shape, false);
  });
});
