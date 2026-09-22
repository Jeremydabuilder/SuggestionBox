import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractCitedRefs, allCitationsAllowed } from "../src/lib/inbox-citations.ts";

describe("extractCitedRefs", () => {
  test("finds every [S###] citation in the text", () => {
    assert.deepEqual(extractCitedRefs("See [S001] and [S042] for details."), ["S001", "S042"]);
  });

  test("deduplicates repeated citations", () => {
    assert.deepEqual(extractCitedRefs("[S001] again, [S001] once more."), ["S001"]);
  });

  test("returns an empty array when there are no citations", () => {
    assert.deepEqual(extractCitedRefs("No citations here."), []);
  });

  test("ignores malformed refs that don't match the exact bracket-S-three-digit shape", () => {
    assert.deepEqual(extractCitedRefs("Not a real ref: [S1] or [SS001] or S001 without brackets."), []);
  });
});

describe("allCitationsAllowed — the allowlist boundary", () => {
  test("true when every cited ref is in the allowed set", () => {
    assert.equal(allCitationsAllowed("Per [S001] and [S002].", new Set(["S001", "S002", "S003"])), true);
  });

  test("false when even one cited ref falls outside the allowed set — no partial trust", () => {
    assert.equal(allCitationsAllowed("Per [S001] and [S999].", new Set(["S001", "S002"])), false);
  });

  test("true (vacuously) when the answer cites nothing at all", () => {
    assert.equal(allCitationsAllowed("No suggestions matched.", new Set(["S001"])), true);
  });

  test("false when the allowed set is empty but the text still cites something", () => {
    assert.equal(allCitationsAllowed("Per [S001].", new Set()), false);
  });
});
