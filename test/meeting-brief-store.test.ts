import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  meetingBriefContentSchema,
  resolveCitations,
  saveMeetingBriefInputSchema,
  stripUnknownRefs,
  updateMeetingBriefInputSchema,
  type MeetingBriefContent,
} from "../src/lib/meeting-brief-store.ts";

function content(overrides: Partial<MeetingBriefContent> = {}): MeetingBriefContent {
  return {
    headline: "This week's priorities",
    executiveSummary: "Focus on lunch and one quick facilities fix.",
    agenda: [
      {
        title: "Lunch options",
        minutes: 10,
        whyNow: "Several students asked.",
        talkingPoints: ["Clarify the request"],
        suggestionRefs: ["S001", "S002"],
      },
    ],
    quickWins: [{ title: "Fix the water fountain", nextStep: "Ask facilities.", suggestionRefs: ["S002"] }],
    decisionsNeeded: [{ question: "Approve the vending change?", context: "Costs money.", suggestionRefs: [] }],
    followUps: [{ action: "Check with admin", suggestedOwner: "Co-president", timing: "Next week", suggestionRefs: ["S999"] }],
    watchouts: [],
    ...overrides,
  };
}

describe("meeting brief content schema", () => {
  test("mirrors the generation schema minus themes", () => {
    const parsed = meetingBriefContentSchema.safeParse(content());
    assert.equal(parsed.success, true);
  });

  test("has no themes field to persist", () => {
    const shape = meetingBriefContentSchema.shape as Record<string, unknown>;
    assert.equal("themes" in shape, false);
  });

  test("save input requires content, sources array, and a draft flag", () => {
    const parsed = saveMeetingBriefInputSchema.safeParse({
      content: content(),
      scope: "new",
      sources: [{ ref: "S001", id: "11111111-1111-4111-8111-111111111111" }],
      isDraft: false,
    });
    assert.equal(parsed.success, true);
  });

  test("update input additionally requires a brief id", () => {
    const withoutId = updateMeetingBriefInputSchema.safeParse({
      content: content(),
      scope: "new",
      sources: [],
      isDraft: false,
    });
    assert.equal(withoutId.success, false);
  });

  test("a forged suggestion id shaped wrong is rejected before it reaches the database", () => {
    const parsed = saveMeetingBriefInputSchema.safeParse({
      content: content(),
      scope: "new",
      sources: [{ ref: "S001", id: "not-a-uuid" }],
      isDraft: false,
    });
    assert.equal(parsed.success, false);
  });
});

describe("resolveCitations — the only place a citation is trusted", () => {
  test("valid citations resolve to real ids and keep their refs", () => {
    const sources = [
      { ref: "S001", id: "11111111-1111-1111-1111-111111111111" },
      { ref: "S002", id: "22222222-2222-2222-2222-222222222222" },
      { ref: "S999", id: "99999999-9999-9999-9999-999999999999" },
    ];
    const existing = new Set(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]);

    const result = resolveCitations(content(), sources, existing);

    // S999 maps to an id that does not exist — its citation is dropped...
    assert.deepEqual(
      result.citations.map((c) => c.ref).sort(),
      ["S001", "S002"],
    );
    // ...and so is its mention in the content, everywhere it appears.
    assert.deepEqual(result.content.followUps[0].suggestionRefs, []);
    assert.deepEqual(result.content.agenda[0].suggestionRefs, ["S001", "S002"]);
  });

  test("a ref with no matching source at all is dropped, not trusted", () => {
    const result = resolveCitations(
      content({ agenda: [{ title: "X", minutes: 5, whyNow: "Y", talkingPoints: ["Z"], suggestionRefs: ["S404"] }] }),
      [{ ref: "S001", id: "11111111-1111-1111-1111-111111111111" }],
      new Set(["11111111-1111-1111-1111-111111111111"]),
    );
    assert.deepEqual(result.citations, []);
    assert.deepEqual(result.content.agenda[0].suggestionRefs, []);
  });

  test("a forged ref->id mapping pointing at an id the president cannot access is rejected", () => {
    // The client claims S001 maps to a real-looking id, but the database
    // query (existingSuggestionIds) never found that id — exactly what a
    // forged or already-deleted suggestion id looks like.
    const result = resolveCitations(
      content({ agenda: [{ title: "X", minutes: 5, whyNow: "Y", talkingPoints: ["Z"], suggestionRefs: ["S001"] }], quickWins: [], decisionsNeeded: [], followUps: [] }),
      [{ ref: "S001", id: "00000000-0000-0000-0000-000000000000" }],
      new Set(), // nothing exists
    );
    assert.deepEqual(result.citations, []);
    assert.deepEqual(result.content.agenda[0].suggestionRefs, []);
  });

  test("the same suggestion cited twice under one ref produces one citation row", () => {
    const c = content({
      agenda: [{ title: "A", minutes: 5, whyNow: "w", talkingPoints: ["t"], suggestionRefs: ["S001"] }],
      quickWins: [{ title: "B", nextStep: "n", suggestionRefs: ["S001"] }],
      decisionsNeeded: [],
      followUps: [],
    });
    const result = resolveCitations(
      c,
      [{ ref: "S001", id: "11111111-1111-1111-1111-111111111111" }],
      new Set(["11111111-1111-1111-1111-111111111111"]),
    );
    assert.equal(result.citations.length, 1);
  });

  test("never mutates the input content object", () => {
    const original = content();
    const snapshot = JSON.parse(JSON.stringify(original));
    resolveCitations(original, [], new Set());
    assert.deepEqual(original, snapshot);
  });
});

describe("stripUnknownRefs", () => {
  test("removes refs everywhere they appear without touching text", () => {
    const stripped = stripUnknownRefs(content(), new Set(["S001"]));
    assert.deepEqual(stripped.agenda[0].suggestionRefs, ["S001"]);
    assert.deepEqual(stripped.quickWins[0].suggestionRefs, []);
    assert.equal(stripped.agenda[0].title, "Lunch options");
  });
});
