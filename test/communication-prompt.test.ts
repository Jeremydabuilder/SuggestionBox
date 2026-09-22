import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCommunicationPrompt,
  communicationDraftSystemPrompt,
  COMMUNICATION_DRAFT_KINDS,
  COMMUNICATION_DRAFT_LIMITS,
} from "../src/lib/communication-prompt.ts";

describe("communicationDraftSystemPrompt", () => {
  for (const kind of COMMUNICATION_DRAFT_KINDS) {
    test(`${kind} — never claims the ability to send, post, or deliver anything`, () => {
      const prompt = communicationDraftSystemPrompt(kind);
      assert.match(prompt, /no ability to send, post, or deliver/i);
    });

    test(`${kind} — evidence is framed as data, never instructions`, () => {
      const prompt = communicationDraftSystemPrompt(kind);
      assert.match(prompt, /never an instruction/i);
    });

    test(`${kind} — requires citation and forbids inventing a ref`, () => {
      const prompt = communicationDraftSystemPrompt(kind);
      assert.match(prompt, /\[S001\]/);
      assert.match(prompt, /[Nn]ever invent a ref/);
    });
  }
});

describe("buildCommunicationPrompt", () => {
  test("falls back to a generic topic when none is given", () => {
    const prompt = buildCommunicationPrompt("", []);
    assert.match(prompt, /Topic: recent workspace activity/);
  });

  test("includes the given topic and evidence", () => {
    const prompt = buildCommunicationPrompt("lunch options", [{ ref: "S001", title: "More vegan options", description: "d", status: "New" }]);
    assert.match(prompt, /Topic: lunch options/);
    assert.match(prompt, /\[S001\]/);
  });

  test("caps evidence at COMMUNICATION_DRAFT_LIMITS.maxEvidence", () => {
    const evidence = Array.from({ length: 20 }, (_, i) => ({ ref: `S${String(i + 1).padStart(3, "0")}`, title: "t", description: "d", status: "New" }));
    const prompt = buildCommunicationPrompt("x", evidence);
    const matches = prompt.match(/\[S\d{3}\]/g) ?? [];
    assert.equal(matches.length, COMMUNICATION_DRAFT_LIMITS.maxEvidence);
  });
});
