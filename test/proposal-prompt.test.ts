import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildProposalPrompt, PROPOSAL_BUILDER_SYSTEM_PROMPT, PROPOSAL_BUILDER_LIMITS } from "../src/lib/proposal-prompt.ts";

describe("PROPOSAL_BUILDER_SYSTEM_PROMPT — the no-invented-costs defense", () => {
  test("explicitly forbids inventing a dollar amount, budget, policy, date, vendor, or promise", () => {
    assert.match(PROPOSAL_BUILDER_SYSTEM_PROMPT, /dollar amount/i);
    assert.match(PROPOSAL_BUILDER_SYSTEM_PROMPT, /budget/i);
    assert.match(PROPOSAL_BUILDER_SYSTEM_PROMPT, /policy citation/i);
  });

  test("tells the model evidence is data, never instructions", () => {
    assert.match(PROPOSAL_BUILDER_SYSTEM_PROMPT, /never an instruction/i);
  });

  test("requires citation of every claim and forbids inventing a ref", () => {
    assert.match(PROPOSAL_BUILDER_SYSTEM_PROMPT, /\[S001\]/);
    assert.match(PROPOSAL_BUILDER_SYSTEM_PROMPT, /[Nn]ever invent a ref/);
  });

  test("states the model cannot submit, send, or approve anything", () => {
    assert.match(PROPOSAL_BUILDER_SYSTEM_PROMPT, /no ability to submit, send, or approve/i);
  });
});

describe("buildProposalPrompt", () => {
  test("falls back to a generic topic description when none is given, rather than an empty line", () => {
    const prompt = buildProposalPrompt("", []);
    assert.match(prompt, /Topic: the most-cited recent suggestions/);
  });

  test("includes the given topic and evidence refs", () => {
    const prompt = buildProposalPrompt("recycling", [{ ref: "S001", title: "More recycling bins", description: "add bins", status: "New" }]);
    assert.match(prompt, /Topic: recycling/);
    assert.match(prompt, /\[S001\]/);
  });

  test("says plainly when there is no matching evidence", () => {
    const prompt = buildProposalPrompt("nonexistent topic", []);
    assert.match(prompt, /no matching suggestions found/i);
  });

  test("caps evidence at PROPOSAL_BUILDER_LIMITS.maxEvidence", () => {
    const evidence = Array.from({ length: 20 }, (_, i) => ({ ref: `S${String(i + 1).padStart(3, "0")}`, title: "t", description: "d", status: "New" }));
    const prompt = buildProposalPrompt("x", evidence);
    const matches = prompt.match(/\[S\d{3}\]/g) ?? [];
    assert.equal(matches.length, PROPOSAL_BUILDER_LIMITS.maxEvidence);
  });
});
