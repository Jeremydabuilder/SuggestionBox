import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_HELP_TOPICS,
  STUDENT_HELP_TOPICS,
  PRESIDENT_HELP_TOPICS,
  findHelpTopic,
  matchHelpTopic,
} from "../src/lib/help-content.ts";

describe("help-content.ts — the one shared source of truth", () => {
  test("every topic has a unique id", () => {
    const ids = ALL_HELP_TOPICS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every topic has at least one non-empty answer paragraph", () => {
    for (const topic of ALL_HELP_TOPICS) {
      assert.ok(topic.answer.length > 0, `${topic.id} should have at least one paragraph`);
      for (const p of topic.answer) assert.ok(p.trim().length > 0, `${topic.id} should not have an empty paragraph`);
    }
  });

  test("student topics are audience 'student' and president topics are audience 'president'", () => {
    assert.ok(STUDENT_HELP_TOPICS.every((t) => t.audience === "student"));
    assert.ok(PRESIDENT_HELP_TOPICS.every((t) => t.audience === "president"));
  });

  test("findHelpTopic resolves a known id and returns undefined for an unknown one", () => {
    assert.equal(findHelpTopic("what-is-this")?.id, "what-is-this");
    assert.equal(findHelpTopic("not-a-real-topic"), undefined);
  });

  test("matchHelpTopic never matches plain conversational text", () => {
    for (const text of ["thanks, that was helpful", "the meeting went really well today", "I think we should talk to the principal"]) {
      assert.equal(matchHelpTopic(text, "president"), undefined);
    }
  });

  test("matchHelpTopic matches an obvious, specific question", () => {
    assert.equal(matchHelpTopic("how does duplicate detection work?", "president")?.id, "duplicate-detection");
    assert.equal(matchHelpTopic("what's the difference between archive and trash?", "president")?.id, "archive-vs-trash");
  });

  test("student and president topic pools never contain each other's topics", () => {
    const studentIds = new Set(STUDENT_HELP_TOPICS.map((t) => t.id));
    const presidentIds = new Set(PRESIDENT_HELP_TOPICS.map((t) => t.id));
    for (const id of studentIds) assert.ok(!presidentIds.has(id));
  });

  test("no topic mentions clustering or needs-attention — those aren't wired into any UI or agent path yet", () => {
    const text = ALL_HELP_TOPICS.map((t) => `${t.question} ${t.answer.join(" ")}`).join(" ").toLowerCase();
    assert.doesNotMatch(text, /\bcluster/);
    assert.doesNotMatch(text, /needs attention/);
  });
});
