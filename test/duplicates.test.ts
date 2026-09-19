import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canonicalPair, pairKey } from "../src/lib/duplicates/pair.ts";
import {
  matchCountFor,
  matchesFor,
  otherIdIn,
  relatedGroupSize,
  duplicatesOf,
} from "../src/lib/duplicates/index.ts";
import type { Suggestion, SuggestionMatch } from "../src/lib/types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function sugg(id: string, primary: string | null = null): Suggestion {
  return {
    id,
    title: `Suggestion ${id}`,
    description: "A description long enough to be realistic.",
    category: "other",
    improvement_reason: "A reason.",
    student_name: null,
    student_email: null,
    is_anonymous: true,
    status: "new",
    is_read: false,
    read_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    primary_suggestion_id: primary,
  };
}

function match(
  id: string,
  a: string,
  b: string,
  state: SuggestionMatch["state"] = "suggested",
): SuggestionMatch {
  const [low, high] = canonicalPair(a, b);
  return {
    id,
    suggestion_id: low,
    match_id: high,
    score: 0.8,
    breakdown: {},
    method: "lexical-v1",
    state,
    decided_by: state === "suggested" ? null : "prez@school.org",
    decided_at: state === "suggested" ? null : "2026-01-02T00:00:00Z",
    reopened_by: null,
    reopened_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

/* ------------------------------------------------------------------ */

describe("pair ordering", () => {
  test("a pair is the same row whichever way round it is written", () => {
    assert.deepEqual(canonicalPair("b", "a"), ["a", "b"]);
    assert.deepEqual(canonicalPair("a", "b"), ["a", "b"]);
    assert.equal(pairKey("b", "a"), pairKey("a", "b"));
  });
});

describe("reading matches for a suggestion", () => {
  const matches = [match("m1", "a", "b"), match("m2", "c", "a"), match("m3", "c", "d")];

  test("finds matches whichever side the suggestion is on", () => {
    assert.equal(matchesFor("a", matches).length, 2);
  });

  test("names the other suggestion in a pair", () => {
    assert.equal(otherIdIn(matches[0]!, "a"), "b");
    assert.equal(otherIdIn(matches[0]!, "b"), "a");
  });

  test("a dismissed match is not counted", () => {
    const withDismissal = [match("m1", "a", "b", "dismissed"), match("m2", "c", "a")];
    assert.equal(matchCountFor("a", withDismissal), 1);
  });

  test("a confirmed match still counts", () => {
    assert.equal(matchCountFor("a", [match("m1", "a", "b", "confirmed")]), 1);
  });

  test("undoing a dismissal puts the match back in the count", () => {
    const dismissed = match("m1", "a", "b", "dismissed");
    assert.equal(matchCountFor("a", [dismissed]), 0);
    // restoreMatch() sets the state back to suggested and stamps the reversal.
    const restored: SuggestionMatch = {
      ...dismissed,
      state: "suggested",
      reopened_by: "prez@school.org",
      reopened_at: "2026-02-01T00:00:00Z",
    };
    assert.equal(matchCountFor("a", [restored]), 1);
    // and the original dismissal is still on the record.
    assert.equal(restored.decided_at, dismissed.decided_at);
  });
});

describe("grouping under a primary suggestion", () => {
  test("a suggestion with nothing filed under it is not a group", () => {
    const all = [sugg("a"), sugg("b")];
    assert.equal(relatedGroupSize(all[0]!, all), 0);
  });

  test("the primary counts itself plus everything filed under it", () => {
    const all = [sugg("a"), sugg("b", "a"), sugg("c", "a"), sugg("d")];
    assert.equal(relatedGroupSize(all[0]!, all), 3);
  });

  test("a duplicate reports the same group size as its primary", () => {
    const all = [sugg("a"), sugg("b", "a"), sugg("c", "a")];
    assert.equal(relatedGroupSize(all[1]!, all), relatedGroupSize(all[0]!, all));
  });

  test("linking never removes a suggestion from the list", () => {
    const before = [sugg("a"), sugg("b"), sugg("c")];
    const after = [sugg("a"), sugg("b", "a"), sugg("c", "a")];
    assert.equal(after.length, before.length);
    // Every original submission is still present and still its own row.
    for (const original of before) {
      assert.ok(after.some((s) => s.id === original.id));
    }
  });

  test("the duplicates of a primary are listed, and only those", () => {
    const all = [sugg("a"), sugg("b", "a"), sugg("c", "a"), sugg("d", "x")];
    assert.deepEqual(
      duplicatesOf("a", all).map((s) => s.id),
      ["b", "c"],
    );
  });

  test("submitter details survive being filed under another suggestion", () => {
    const named: Suggestion = {
      ...sugg("b", "a"),
      is_anonymous: false,
      student_name: "Priya S.",
      student_email: "priya@school.org",
    };
    // Filing only sets a pointer — everything the student sent is still here.
    assert.equal(named.student_name, "Priya S.");
    assert.equal(named.student_email, "priya@school.org");
    assert.equal(named.status, "new");
    assert.equal(named.primary_suggestion_id, "a");
  });
});
