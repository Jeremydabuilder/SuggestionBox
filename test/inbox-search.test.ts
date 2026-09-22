import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { searchInboxSuggestions, type SearchableSuggestion } from "../src/lib/inbox-search.ts";

function suggestion(overrides: Partial<SearchableSuggestion>): SearchableSuggestion {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Untitled",
    description: "",
    improvement_reason: "",
    category: "other",
    status: "new",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("searchInboxSuggestions — keyword matching", () => {
  test("an empty query matches everything", () => {
    const result = searchInboxSuggestions([suggestion({ id: "a" }), suggestion({ id: "b" })], {}, 10);
    assert.equal(result.totalMatches, 2);
  });

  test("matches a keyword in title, description, or improvement_reason, case-insensitively", () => {
    const result = searchInboxSuggestions(
      [
        suggestion({ id: "a", title: "More Vegan Options" }),
        suggestion({ id: "b", description: "we need vegan food" }),
        suggestion({ id: "c", improvement_reason: "students want VEGAN choices" }),
        suggestion({ id: "d", title: "New basketball hoops" }),
      ],
      { query: "vegan" },
      10,
    );
    assert.equal(result.totalMatches, 3);
    assert.ok(!result.hits.some((h) => h.id === "d"));
  });

  test("a query with no matches returns zero hits, not an error", () => {
    const result = searchInboxSuggestions([suggestion({ title: "New basketball hoops" })], { query: "nonexistentxyz" }, 10);
    assert.equal(result.totalMatches, 0);
    assert.deepEqual(result.hits, []);
  });
});

describe("searchInboxSuggestions — filters", () => {
  test("category filter excludes non-matching categories", () => {
    const result = searchInboxSuggestions(
      [suggestion({ id: "a", category: "food" }), suggestion({ id: "b", category: "events" })],
      { category: "food" },
      10,
    );
    assert.equal(result.totalMatches, 1);
    assert.equal(result.hits[0]!.id, "a");
  });

  test("status filter excludes non-matching statuses", () => {
    const result = searchInboxSuggestions(
      [suggestion({ id: "a", status: "new" }), suggestion({ id: "b", status: "completed" })],
      { status: "completed" },
      10,
    );
    assert.equal(result.totalMatches, 1);
    assert.equal(result.hits[0]!.id, "b");
  });

  test("category and status combine as AND, not OR", () => {
    const result = searchInboxSuggestions(
      [
        suggestion({ id: "a", category: "food", status: "new" }),
        suggestion({ id: "b", category: "food", status: "completed" }),
        suggestion({ id: "c", category: "events", status: "new" }),
      ],
      { category: "food", status: "new" },
      10,
    );
    assert.equal(result.totalMatches, 1);
    assert.equal(result.hits[0]!.id, "a");
  });
});

describe("searchInboxSuggestions — refs and ordering", () => {
  test("caps hits at the limit but keeps the true totalMatches count", () => {
    const many = Array.from({ length: 20 }, (_, i) => suggestion({ id: `s${i}`, created_at: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
    const result = searchInboxSuggestions(many, {}, 5);
    assert.equal(result.totalMatches, 20);
    assert.equal(result.hits.length, 5);
  });

  test("assigns positional S### refs in most-recent-first order", () => {
    const result = searchInboxSuggestions(
      [
        suggestion({ id: "old", created_at: "2026-08-01T00:00:00.000Z" }),
        suggestion({ id: "new", created_at: "2026-09-01T00:00:00.000Z" }),
      ],
      {},
      10,
    );
    assert.equal(result.hits[0]!.id, "new");
    assert.equal(result.hits[0]!.ref, "S001");
    assert.equal(result.hits[1]!.ref, "S002");
  });

  test("refToId resolves each assigned ref back to its real suggestion id", () => {
    const result = searchInboxSuggestions([suggestion({ id: "real-id" })], {}, 10);
    assert.equal(result.refToId.get("S001"), "real-id");
  });

  test("never leaks a student_name or student_email field — the input type structurally has none", () => {
    const result = searchInboxSuggestions([suggestion({})], {}, 10);
    assert.ok(!("student_name" in result.hits[0]!));
    assert.ok(!("student_email" in result.hits[0]!));
  });
});
