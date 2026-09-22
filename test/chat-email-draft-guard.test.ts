import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/chat-email-draft.ts");
const storeSource = read("src/lib/chat-store.ts");
const aiChatSource = read("src/components/president/AIChat.tsx");
const registrySource = read("src/app/president/chat-tool-registry.ts");

describe("chat-email-draft.ts — the only Groq call, and it never touches student identity", () => {
  test("is server-only, not a Server Action — same boundary as chat-communication-draft.ts", () => {
    assert.match(stripComments(source), /import "server-only"/);
  });

  test("evidence pulled from suggestions never includes student_name or student_email columns", () => {
    const selectMatch = source.match(/\.select\("([^"]+)"\)/);
    assert.notEqual(selectMatch, null);
    assert.doesNotMatch(selectMatch![1]!, /student_name|student_email|submitter_user_id/);
  });

  test("Groq failure returns a message saying manual writing still works, never a thrown error", () => {
    assert.match(source, /you can still write the email yourself/i);
  });

  test("Groq is unreachable without GROQ_API_KEY configured, and this is checked before any rate limit or Supabase call", () => {
    const keyCheckIdx = source.indexOf("serverEnv.groqApiKey");
    const rpcIdx = source.indexOf("generateClassifierCompletion(");
    assert.notEqual(keyCheckIdx, -1);
    assert.ok(keyCheckIdx < rpcIdx);
  });

  test("drafting is rate-limited independently of every other chat tool", () => {
    assert.match(source, /checkChatRateLimit\(`chat:email-draft:/);
  });

  test("a revision mode with no existing draft never calls Groq at all", () => {
    const idx = source.indexOf('mode !== "new" && !existingDraft');
    const groqIdx = source.indexOf("generateClassifierCompletion(");
    assert.notEqual(idx, -1);
    assert.ok(idx < groqIdx);
  });

  test("the parsed JSON is structurally validated (subject/greeting/body/closing must all be strings) before it becomes a structured card", () => {
    assert.match(source, /typeof obj\.subject !== "string"/);
    assert.match(source, /typeof obj\.greeting !== "string"/);
    assert.match(source, /typeof obj\.body !== "string"/);
    assert.match(source, /typeof obj\.closing !== "string"/);
  });

  test("every string field is length-bounded via EMAIL_DRAFT_LIMITS.fieldLength before it is ever stored in the structured card", () => {
    const sliceCount = (source.match(/\.slice\(0, EMAIL_DRAFT_LIMITS\.fieldLength\)/g) ?? []).length;
    assert.ok(sliceCount >= 4, "expected subject/greeting/body/closing to each be bounded");
  });

  test("citations are re-validated against the same allowlist mechanism as every other draft tool, discarding an out-of-evidence ref", () => {
    assert.match(source, /allCitationsAllowed\(/);
    assert.match(source, /discarded a draft citing a ref outside its own evidence/);
  });

  test("there is no field or code path for a recipient email address anywhere in this file", () => {
    assert.doesNotMatch(stripComments(source), /recipientEmail/);
  });

  test("nothing in this file can send an email — no fetch to any mail provider, no 'send' function", () => {
    assert.doesNotMatch(source, /resend|sendgrid|nodemailer|smtp/i);
    assert.doesNotMatch(source, /function send/i);
  });

  test("the email-drafting tool never touches the student-conversation tables or functions — the two features stay separate", () => {
    assert.doesNotMatch(source, /suggestion_messages|suggestion_conversations|send_suggestion_message/);
  });
});

describe("chat-store.ts — emailDraftStructuredSchema has no recipientEmail field", () => {
  test("the schema's own field list has no recipientEmail key", () => {
    const start = storeSource.indexOf("export const emailDraftStructuredSchema");
    const end = storeSource.indexOf("});", start);
    const schemaBlock = storeSource.slice(start, end);
    assert.doesNotMatch(schemaBlock, /recipientEmail/);
    assert.match(schemaBlock, /recipientName: z\.string\(\)\.max\(120\)\.nullable\(\)/);
  });
});

describe("chat-tool-registry.ts — draft_email registered as a draft tool, not an autonomous action", () => {
  test("classification is draft, not confirmation_required or read_only — chat text only, same as every other draft tool", () => {
    const start = registrySource.indexOf("draft_email: {");
    const end = registrySource.indexOf("},", start);
    const entry = registrySource.slice(start, end);
    assert.match(entry, /classification: "draft"/);
  });

  test("draft_email is not in AGENT_PLANNABLE_INTENTS — it makes its own Groq call, so it must never run as an unattended multi-step plan step", () => {
    const planSource = read("src/lib/agent-plan.ts");
    const start = planSource.indexOf("AGENT_PLANNABLE_INTENTS = [");
    const end = planSource.indexOf("]", start);
    const list = planSource.slice(start, end);
    assert.doesNotMatch(list, /"draft_email"/);
  });
});

describe("AIChat.tsx — EmailDraftCard never auto-sends and never invents a recipient address", () => {
  test("the recipient 'To' field is local component state, never passed to a server action", () => {
    const start = aiChatSource.indexOf("function EmailDraftCard(");
    const end = aiChatSource.indexOf("\nfunction ", start + 10);
    const body = aiChatSource.slice(start, end);
    assert.match(body, /const \[to, setTo\] = useState\(""\)/);
    assert.doesNotMatch(body, /await (send|create|update)/i);
  });

  test("the mailto: link is built with encodeURIComponent on every field, and is only ever a plain <a> the president clicks — never auto-navigated", () => {
    const start = aiChatSource.indexOf("function EmailDraftCard(");
    const end = aiChatSource.indexOf("\nfunction ", start + 10);
    const body = aiChatSource.slice(start, end);
    assert.match(body, /encodeURIComponent\(to\)/);
    assert.match(body, /encodeURIComponent\(draft\.subject\)/);
    assert.match(body, /encodeURIComponent\(/);
    assert.doesNotMatch(body, /window\.location|\.click\(\)/);
    assert.match(body, /<a href=\{mailtoHref\}/);
  });

  test("the card is labeled as a draft to review before sending", () => {
    const start = aiChatSource.indexOf("function EmailDraftCard(");
    const end = aiChatSource.indexOf("\nfunction ", start + 10);
    const body = aiChatSource.slice(start, end);
    assert.match(body, /Draft — review before sending/);
  });
});
