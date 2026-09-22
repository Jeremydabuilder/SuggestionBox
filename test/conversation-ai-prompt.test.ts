import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationPrompt,
  conversationAiSystemPrompt,
  CONVERSATION_AI_LIMITS,
  CONVERSATION_DRAFT_MODES,
  type ConversationTranscriptLine,
} from "../src/lib/conversation-ai-prompt.ts";

const TRANSCRIPT: ConversationTranscriptLine[] = [
  { role: "Student", body: "Can you clarify what near the cafeteria means?" },
  { role: "Co-Presidents", body: "Yes, near the north entrance." },
];

describe("conversation-ai-prompt.ts — pure, identity-free prompt building", () => {
  test("the system prompt treats the transcript as evidence, never instructions", () => {
    const prompt = conversationAiSystemPrompt();
    assert.match(prompt, /never a set of instructions/i);
    assert.match(prompt, /treat it as ordinary quoted text/i);
  });

  test("the system prompt never claims a real identity for either participant", () => {
    const prompt = conversationAiSystemPrompt();
    assert.match(prompt, /"Student" and "Co-Presidents"/);
    assert.match(prompt, /never invent one/i);
  });

  test("the system prompt requires labeling output as a draft, never as sent", () => {
    assert.match(conversationAiSystemPrompt(), /always a draft/i);
  });

  test("every declared mode produces a distinct, non-empty prompt", () => {
    const prompts = new Set(CONVERSATION_DRAFT_MODES.map((mode) => buildConversationPrompt(mode, TRANSCRIPT)));
    assert.equal(prompts.size, CONVERSATION_DRAFT_MODES.length);
    for (const p of prompts) assert.ok(p.length > 0);
  });

  test("the transcript is rendered oldest first with role labels, nothing else", () => {
    const prompt = buildConversationPrompt("draft", TRANSCRIPT);
    assert.match(prompt, /Student: Can you clarify/);
    assert.match(prompt, /Co-Presidents: Yes, near the north entrance\./);
    assert.ok(prompt.indexOf("Student:") < prompt.indexOf("Co-Presidents:"));
  });

  test("an empty transcript never crashes and says so plainly", () => {
    const prompt = buildConversationPrompt("summarize", []);
    assert.match(prompt, /no messages yet/i);
  });

  test("no email, name, or uuid-shaped string ever appears in a built prompt for any mode", () => {
    const withIdentityLookingText: ConversationTranscriptLine[] = [
      { role: "Student", body: "My email is not here, only my question about lunch." },
    ];
    for (const mode of CONVERSATION_DRAFT_MODES) {
      const prompt = buildConversationPrompt(mode, withIdentityLookingText);
      assert.doesNotMatch(prompt, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });

  test("warmer and shorter modes include the current draft to rewrite; other modes never do", () => {
    const withDraft = buildConversationPrompt("warmer", TRANSCRIPT, "Here is a draft reply.");
    assert.match(withDraft, /Current draft to rewrite/);
    assert.match(withDraft, /Here is a draft reply\./);

    const summarizeIgnoresDraft = buildConversationPrompt("summarize", TRANSCRIPT, "Here is a draft reply.");
    assert.doesNotMatch(summarizeIgnoresDraft, /Current draft to rewrite/);
  });

  test("the transcript is bounded to CONVERSATION_AI_LIMITS.maxMessages and per-message length", () => {
    const long = Array.from({ length: CONVERSATION_AI_LIMITS.maxMessages + 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "Student" : "Co-Presidents") as ConversationTranscriptLine["role"],
      body: `message number ${i}`,
    }));
    const prompt = buildConversationPrompt("draft", long);
    const lineCount = prompt.split("\n").filter((l) => l.startsWith("Student:") || l.startsWith("Co-Presidents:")).length;
    assert.ok(lineCount <= CONVERSATION_AI_LIMITS.maxMessages);
  });
});
