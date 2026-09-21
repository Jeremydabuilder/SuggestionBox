import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  anonymizeSuggestions,
  buildMeetingPrompt,
  parseMeetingBrief,
  selectSuggestionsForScope,
} from "../src/lib/meeting-agent.ts";
import type { Suggestion } from "../src/lib/types.ts";
import { rankGroqModels } from "../src/lib/groq.ts";

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "private-database-id",
    title: "More vegetarian lunch choices",
    description: "Please add more vegetarian choices during lunch every day.",
    category: "food",
    improvement_reason: "More students could find something they can eat.",
    student_name: "Private Student",
    student_email: "private@student.school",
    is_anonymous: false,
    status: "new",
    is_read: false,
    read_at: null,
    created_at: "2026-09-20T12:00:00.000Z",
    updated_at: "2026-09-20T12:00:00.000Z",
    primary_suggestion_id: null,
    submitter_user_id: "private-auth-id",
    ...overrides,
  };
}

describe("meeting agent privacy boundary", () => {
  test("the provider payload contains ideas but no identifying fields or database ids", () => {
    const { records, sources } = anonymizeSuggestions([suggestion()]);
    const prompt = buildMeetingPrompt(records, "new");

    assert.equal(records[0].ref, "S001");
    assert.match(prompt, /vegetarian lunch/i);
    assert.doesNotMatch(prompt, /Private Student/);
    assert.doesNotMatch(prompt, /private@student\.school/);
    assert.doesNotMatch(prompt, /private-auth-id/);
    assert.doesNotMatch(prompt, /private-database-id/);
    assert.equal(sources[0].id, "private-database-id");
  });

  test("archived suggestions do not leave the server", () => {
    const { records } = anonymizeSuggestions([
      suggestion(),
      suggestion({ id: "archived", title: "Old private idea", status: "archived" }),
    ]);
    assert.equal(records.length, 1);
    assert.doesNotMatch(JSON.stringify(records), /Old private idea/);
  });
});

describe("meeting agent scope and output", () => {
  test("selects only models Groq actually reports as available", () => {
    assert.deepEqual(
      rankGroqModels(["retired-model", "qwen/qwen3-32b", "whisper-large-v3"]),
      ["qwen/qwen3-32b"],
    );
  });

  test("a configured model override wins when it is available", () => {
    assert.equal(
      rankGroqModels(["school/custom-instruct", "openai/gpt-oss-20b"], "school/custom-instruct")[0],
      "school/custom-instruct",
    );
  });

  test("past 7 days has an exact, testable boundary", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    const selected = selectSuggestionsForScope([
      suggestion({ id: "recent", created_at: "2026-09-15T12:00:00.000Z" }),
      suggestion({ id: "old", created_at: "2026-09-13T11:59:59.000Z" }),
    ], "new", now);
    assert.deepEqual(selected.map((item) => item.id), ["recent"]);
  });

  test("validates JSON even when the provider wraps it in a fence", () => {
    const result = parseMeetingBrief(`\`\`\`json
      {
        "headline":"This week's priorities",
        "executiveSummary":"Focus on lunch and one quick facilities fix.",
        "themes":[],
        "agenda":[{"title":"Lunch","minutes":10,"whyNow":"Several students asked.","talkingPoints":["Clarify the request"],"suggestionRefs":["S001"]}],
        "quickWins":[],
        "decisionsNeeded":[],
        "followUps":[],
        "watchouts":[]
      }
    \`\`\``);
    assert.equal(result.agenda[0].minutes, 10);
  });

  test("rejects prose instead of quietly displaying malformed output", () => {
    assert.throws(() => parseMeetingBrief("Here is your meeting plan."));
  });
});
