import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/chat-orchestration-actions.ts");

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("chat-orchestration-actions.ts — the one browser-callable send entry point", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(source), /"use server"/);
  });

  test("declares exactly one exported action", () => {
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(exported, ["sendChatMessage"]);
  });

  test("sendChatMessage calls getPresidentSession() before anything else — identity is never taken from the caller", () => {
    const body = functionBody("sendChatMessage");
    const sessionIndex = body.indexOf("getPresidentSession()");
    assert.notEqual(sessionIndex, -1, "must call getPresidentSession()");
    const sendUserMessageIndex = body.indexOf("sendUserMessage(");
    const routeIndex = body.indexOf("routeChatMessage(");
    const insertIndex = body.indexOf("insertAssistantMessage(");
    assert.ok(sessionIndex < sendUserMessageIndex);
    assert.ok(sessionIndex < routeIndex);
    assert.ok(sessionIndex < insertIndex);
  });

  test("sendChatMessage's own parameters carry no identity, role, or structured payload — only a conversation id and raw content", () => {
    const signature = source.match(/export async function sendChatMessage\(([^)]*)\)/)?.[1] ?? "";
    assert.match(signature, /rawConversationId/);
    assert.match(signature, /rawContent/);
    assert.doesNotMatch(signature.toLowerCase(), /role|structured|creat|email|session|identity/);
  });

  test("routeChatMessage is called with the verified session object, not a claimed identity string", () => {
    const body = functionBody("sendChatMessage");
    assert.match(body, /routeChatMessage\(session,/);
  });

  test("the assistant reply is always persisted through insertAssistantMessage — never a direct table write", () => {
    assert.doesNotMatch(source, /from\("chat_messages"\)\.insert/);
    assert.match(source, /insertAssistantMessage\(session,/);
  });

  test("does not import or use the service-role client directly", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });

  test("no Groq call anywhere in this file — routing/Groq calls stay inside chat-router.ts", () => {
    assert.doesNotMatch(source, /groq/i);
  });
});
