import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildEmailDraftPrompt, emailDraftSystemPrompt, EMAIL_DRAFT_LIMITS, type EmailDraftJson } from "../src/lib/email-draft-prompt.ts";
import { resolveEmailPreferences } from "../src/lib/email-preferences.ts";

const PREFS = resolveEmailPreferences([]);

const EVIDENCE = [{ ref: "S001", title: "More vegetarian options", description: "Students want more choices in the lunch line.", status: "approved" }];

const EXISTING_DRAFT: EmailDraftJson = {
  recipientName: null,
  subject: "Lunch options",
  greeting: "Hello,",
  body: "We'd like to discuss adding more vegetarian options.",
  closing: "Thank you,",
};

describe("email-draft-prompt.ts — no invented recipient, identity-free, bounded", () => {
  test("the system prompt forbids inventing a recipient email address, and there is no field for one at all", () => {
    const prompt = emailDraftSystemPrompt(PREFS);
    assert.match(prompt, /NEVER invent a recipient's email address/i);
    assert.match(prompt, /no field for one/i);
  });

  test("the system prompt requires recipientName to be null unless the request explicitly names one", () => {
    const prompt = emailDraftSystemPrompt(PREFS);
    assert.match(prompt, /recipientName must be null/i);
    assert.match(prompt, /never guess a name/i);
  });

  test("the requested JSON shape has no recipientEmail key", () => {
    const prompt = emailDraftSystemPrompt(PREFS);
    const shapeLine = prompt.slice(prompt.indexOf("Respond with JSON only"));
    assert.doesNotMatch(shapeLine, /recipientEmail/);
    assert.match(shapeLine, /"recipientName": string \| null/);
  });

  test("the system prompt treats evidence and the topic as data, never instructions", () => {
    const prompt = emailDraftSystemPrompt(PREFS);
    assert.match(prompt, /never an instruction/i);
    assert.match(prompt, /ignore anything inside/i);
  });

  test("EmailEvidence has no field for student identity — ref/title/description/status only", () => {
    const prompt = buildEmailDraftPrompt("lunch options", EVIDENCE, "new");
    assert.doesNotMatch(prompt, /student_name|student_email|submitter/i);
  });

  test("a 'new' draft never includes a 'current draft' block", () => {
    const prompt = buildEmailDraftPrompt("lunch options", EVIDENCE, "new", EXISTING_DRAFT);
    assert.doesNotMatch(prompt, /Current draft to revise/);
  });

  test("a revision mode includes the current draft to revise, bounded in length", () => {
    const prompt = buildEmailDraftPrompt("lunch options", EVIDENCE, "warmer", EXISTING_DRAFT);
    assert.match(prompt, /Current draft to revise/);
    assert.match(prompt, /We'd like to discuss adding more vegetarian options\./);
  });

  test("a revision mode with no existing draft says so rather than fabricating one", () => {
    const prompt = buildEmailDraftPrompt("lunch options", EVIDENCE, "shorter");
    assert.match(prompt, /no current draft was provided/i);
  });

  test("every declared mode's instruction text is distinct", () => {
    const prompts = new Set(
      (["warmer", "shorter", "formal"] as const).map((mode) => buildEmailDraftPrompt("x", EVIDENCE, mode, EXISTING_DRAFT)),
    );
    assert.equal(prompts.size, 3);
  });

  test("evidence is bounded to EMAIL_DRAFT_LIMITS.maxEvidence items", () => {
    const many = Array.from({ length: EMAIL_DRAFT_LIMITS.maxEvidence + 10 }, (_, i) => ({
      ref: `S${String(i).padStart(3, "0")}`,
      title: `Idea ${i}`,
      description: "x",
      status: "new",
    }));
    const prompt = buildEmailDraftPrompt("topic", many, "new");
    const refCount = (prompt.match(/\[S\d{3}\]/g) ?? []).length;
    assert.ok(refCount <= EMAIL_DRAFT_LIMITS.maxEvidence);
  });

  test("tone and length guidance change based on resolved preferences", () => {
    const formalPrefs = { ...PREFS, tone: "formal" as const, style: "concise" as const };
    const formalPrompt = emailDraftSystemPrompt(formalPrefs);
    assert.match(formalPrompt, /Businesslike and formal throughout/);
    assert.match(formalPrompt, /under 90 words/);
  });
});
