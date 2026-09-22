import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const studentSource = read("src/app/my-ideas/conversation-actions.ts");
const presidentSource = read("src/app/president/conversation-actions.ts");
const aiSource = read("src/app/president/conversation-ai-actions.ts");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("my-ideas/conversation-actions.ts — student side", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(studentSource), /"use server"/);
  });

  test("derives identity from the student's own auth session, never a client-supplied id or email", () => {
    assert.match(studentSource, /supabase\.auth\.getUser\(\)/);
    assert.doesNotMatch(studentSource, /rawEmail|clientEmail/);
  });

  test("never uses the service-role client", () => {
    assert.doesNotMatch(studentSource, /createSupabaseServiceClient/);
  });

  test("never selects from suggestion_messages directly — only through the safe RPCs", () => {
    assert.doesNotMatch(stripComments(studentSource), /\.from\("suggestion_messages"\)/);
    assert.match(studentSource, /\.rpc\("list_my_conversation_messages"/);
  });

  test("sending and marking-read go through send_suggestion_message / mark_conversation_read_by_student, never a raw write", () => {
    assert.match(studentSource, /\.rpc\("send_suggestion_message"/);
    assert.match(studentSource, /\.rpc\("mark_conversation_read_by_student"/);
    assert.doesNotMatch(studentSource, /\.from\("suggestion_conversations"\)\s*\.(insert|update|delete|upsert)\(/);
  });

  test("every suggestion id argument is validated against a UUID pattern before use", () => {
    for (const name of ["getMyConversation", "sendMyMessage", "markMyConversationRead"]) {
      const body = functionBody(studentSource, name);
      assert.match(body, /UUID_RE\.test\(suggestionId\)/, `${name} must validate its id argument`);
    }
  });

  test("the message body is sanitized and length-bounded before being sent", () => {
    const body = functionBody(studentSource, "sendMyMessage");
    assert.match(body, /sanitizeText\(rawBody, MESSAGE_MAX_LENGTH\)/);
  });

  test("sending a message is rate-limited", () => {
    const body = functionBody(studentSource, "sendMyMessage");
    assert.match(body, /checkChatRateLimit\(/);
  });

  test("no Groq call anywhere — reading and sending are fully deterministic", () => {
    assert.doesNotMatch(stripComments(studentSource), /groq/i);
  });

  test("getMyConversationSummaries never exposes message content or sender identity, only counts/state", () => {
    const body = functionBody(studentSource, "getMyConversationSummaries");
    assert.doesNotMatch(body, /sender_email|body/);
  });
});

describe("president/conversation-actions.ts — president side", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(presidentSource), /"use server"/);
  });

  for (const name of [
    "getConversation",
    "sendPresidentMessage",
    "resolveConversation",
    "reopenConversation",
    "markConversationReadByPresident",
    "getConversationSummaries",
  ]) {
    test(`${name} calls getPresidentSession() before touching Supabase`, () => {
      const body = functionBody(presidentSource, name);
      const sessionIndex = body.indexOf("getPresidentSession()");
      const clientIndex = body.indexOf("createSupabaseServerClient()");
      assert.notEqual(sessionIndex, -1, `${name} must call getPresidentSession()`);
      assert.notEqual(clientIndex, -1, `${name} must use the session-scoped client`);
      assert.ok(sessionIndex < clientIndex, `${name} must check the session before creating a Supabase client`);
    });
  }

  test("never uses the service-role client", () => {
    assert.doesNotMatch(presidentSource, /createSupabaseServiceClient/);
  });

  test("never selects from suggestion_messages directly — only through the safe RPC", () => {
    assert.doesNotMatch(stripComments(presidentSource), /\.from\("suggestion_messages"\)/);
    assert.match(presidentSource, /\.rpc\("list_president_conversation_messages"/);
  });

  test("every mutation goes through its named RPC, never a raw write", () => {
    assert.match(presidentSource, /\.rpc\("send_suggestion_message"/);
    assert.match(presidentSource, /\.rpc\("resolve_suggestion_conversation"/);
    assert.match(presidentSource, /\.rpc\("reopen_suggestion_conversation"/);
    assert.match(presidentSource, /\.rpc\("mark_conversation_read_by_president"/);
    assert.doesNotMatch(presidentSource, /\.from\("suggestion_conversations"\)\s*\.(insert|update|delete|upsert)\(/);
  });

  test("the message body is sanitized and length-bounded before being sent", () => {
    const body = functionBody(presidentSource, "sendPresidentMessage");
    assert.match(body, /sanitizeText\(rawBody, MESSAGE_MAX_LENGTH\)/);
  });

  test("sending a message is rate-limited", () => {
    const body = functionBody(presidentSource, "sendPresidentMessage");
    assert.match(body, /checkChatRateLimit\(/);
  });

  test("no Groq call anywhere — reading, sending, resolve/reopen are fully deterministic", () => {
    assert.doesNotMatch(stripComments(presidentSource), /groq/i);
  });

  test("getConversationSummaries reads per-caller president_reads rather than a shared single timestamp", () => {
    const body = functionBody(presidentSource, "getConversationSummaries");
    assert.match(body, /president_reads/);
    assert.match(body, /reads\[email\]/);
  });
});

describe("president/conversation-ai-actions.ts — the only Groq call in the conversation feature", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(aiSource), /"use server"/);
  });

  test("draftConversationReply calls getPresidentSession() before touching Supabase", () => {
    const body = functionBody(aiSource, "draftConversationReply");
    const sessionIndex = body.indexOf("getPresidentSession()");
    const clientIndex = body.indexOf("createSupabaseServerClient()");
    assert.notEqual(sessionIndex, -1);
    assert.notEqual(clientIndex, -1);
    assert.ok(sessionIndex < clientIndex);
  });

  test("reads the transcript through the president-safe RPC, then strips it down to role + body only before building a prompt", () => {
    assert.match(aiSource, /\.rpc\("list_president_conversation_messages"/);
    const body = functionBody(aiSource, "draftConversationReply");
    // The mapped transcript object literal must only ever carry role/body —
    // sender_email and sender_user_id from the RPC row must never survive
    // into the object passed to buildConversationPrompt.
    const mapMatch = body.match(/const transcript: ConversationTranscriptLine\[\] = rows\.map\(\(r\) => \(\{([\s\S]*?)\}\)\);/);
    assert.notEqual(mapMatch, null, "expected a role/body-only transcript mapping");
    const mappedFields = mapMatch![1]!;
    assert.doesNotMatch(mappedFields, /sender_email/);
    assert.doesNotMatch(mappedFields, /sender_user_id/);
  });

  test("this is the only file in the conversation feature that imports generateAnswerCompletion", () => {
    assert.match(aiSource, /generateAnswerCompletion/);
    const studentHasGroq = /generateAnswerCompletion|generateClassifierCompletion/.test(studentSource);
    const presidentHasGroq = /generateAnswerCompletion|generateClassifierCompletion/.test(presidentSource);
    assert.equal(studentHasGroq, false);
    assert.equal(presidentHasGroq, false);
  });

  test("requires an explicit mode from a fixed, closed set — never an arbitrary instruction string", () => {
    assert.match(aiSource, /CONVERSATION_DRAFT_MODES as readonly string\[\]/);
  });

  test("a draft never triggers a send, a status change, or a memory write — no such call exists in this file", () => {
    assert.doesNotMatch(aiSource, /sendPresidentMessage|resolveConversation|reopenConversation|create_chat_pending_confirmation|save_memory/);
  });

  test("drafting is rate-limited independently of message sending", () => {
    const body = functionBody(aiSource, "draftConversationReply");
    assert.match(body, /checkChatRateLimit\(`conversation:ai:/);
  });

  test("a suggestion id is validated and a mode is validated against the closed enum before any Supabase or Groq call", () => {
    const body = functionBody(aiSource, "draftConversationReply");
    const uuidCheck = body.indexOf("UUID_RE.test(suggestionId)");
    const modeCheck = body.indexOf("CONVERSATION_DRAFT_MODES");
    const rpcCall = body.indexOf(".rpc(");
    assert.notEqual(uuidCheck, -1);
    assert.notEqual(modeCheck, -1);
    assert.ok(uuidCheck < rpcCall && modeCheck < rpcCall);
  });
});
