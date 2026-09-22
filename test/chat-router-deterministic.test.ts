import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { routeDeterministically } from "../src/lib/chat-router-deterministic.ts";

describe("every suggested starter prompt routes deterministically", () => {
  const cases: Array<[string, string]> = [
    ["Prepare our next meeting", "meeting_prep"],
    ["What changed since our last meeting?", "since_last_meeting"],
    ["What needs attention?", "since_last_meeting"],
    ["Show open action items", "list_actions"],
    ["Show recent decisions", "list_decisions"],
    ["Build a proposal", "proposal_builder"],
    ["Draft an assembly update", "draft_communication"],
    ["Review meeting history", "meeting_history"],
    ["Show meeting history", "meeting_history"],
    ["Manage memory", "memory_manager"],
    ["Help", "help"],
    ["What's trending?", "trend_radar"],
    ["Check for missing follow-ups", "promise_tracker"],
  ];

  for (const [prompt, expectedIntent] of cases) {
    test(`"${prompt}" -> ${expectedIntent}, with zero ambiguity`, () => {
      const result = routeDeterministically(prompt);
      assert.notEqual(result, null, `expected a deterministic route for "${prompt}"`);
      assert.equal(result!.intent, expectedIntent);
      assert.equal(result!.source, "deterministic");
    });
  }

  test('"Search student suggestions" (no topic given) asks for clarification rather than guessing', () => {
    const result = routeDeterministically("Search student suggestions");
    assert.notEqual(result, null);
    assert.equal(result!.intent, "clarification_needed");
    assert.equal(result!.needsClarification, true);
  });
});

describe("natural-language variants of the same commands", () => {
  test("extracts a search topic from a natural phrasing", () => {
    const result = routeDeterministically("Search suggestions about lunch");
    assert.equal(result!.intent, "search_inbox");
    assert.equal((result!.args as { query?: string }).query, "lunch");
  });

  test("a bare 'find X' also routes to search with the topic", () => {
    const result = routeDeterministically("find the vending machine idea");
    assert.equal(result!.intent, "search_inbox");
    assert.equal((result!.args as { query?: string }).query, "the vending machine idea");
  });

  test("recognizes overdue vs open vs due-soon action phrasing distinctly", () => {
    assert.equal((routeDeterministically("show overdue actions")!.args as { status?: string }).status, "overdue");
    assert.equal((routeDeterministically("show open action items")!.args as { status?: string }).status, "open");
    assert.equal((routeDeterministically("what actions are due soon")!.args as { status?: string }).status, "due_soon");
  });

  test("'turn these into a proposal' routes to proposal_builder", () => {
    assert.equal(routeDeterministically("turn these lunch suggestions into a proposal")!.intent, "proposal_builder");
  });

  test("'draft a meeting recap' picks the right communication kind", () => {
    const result = routeDeterministically("draft a meeting recap for the team");
    assert.equal(result!.intent, "draft_communication");
    assert.equal((result!.args as { kind?: string }).kind, "meeting_recap");
  });
});

describe("deterministic routing never guesses at ambiguous or destructive requests", () => {
  test("plain conversational text is not routed at all (falls through to the classifier)", () => {
    assert.equal(routeDeterministically("thanks, that was helpful"), null);
    assert.equal(routeDeterministically("the meeting went really well today"), null);
    assert.equal(routeDeterministically("I think we should talk to the principal"), null);
  });

  test("an empty or whitespace-only message returns null, not a guessed intent", () => {
    assert.equal(routeDeterministically(""), null);
    assert.equal(routeDeterministically("   "), null);
  });

  test("no deterministic rule ever produces anything other than a validated RouteDecision shape", () => {
    const prompts = ["help", "show open action items", "search suggestions about food", "manage memory"];
    for (const prompt of prompts) {
      const result = routeDeterministically(prompt);
      assert.notEqual(result, null);
      assert.equal(result!.source, "deterministic");
      assert.ok(["high", "medium", "low"].includes(result!.confidence));
    }
  });
});
