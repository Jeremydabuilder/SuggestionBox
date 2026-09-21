import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

const chatActionsSource = read("src/app/president/chat-actions.ts");
const chatMemoryActionsSource = read("src/app/president/chat-memory-actions.ts");
const chatInternalSource = read("src/app/president/chat-assistant-internal.ts");
/** Strip comments so a prose note describing what the file does NOT have doesn't trip a search for it. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(`${ROOT}${dir}`, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listFilesRecursive(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const CHAT_ACTIONS_EXPORTS = [
  "createConversation",
  "listConversations",
  "openConversation",
  "renameConversation",
  "deleteConversation",
  "listMessages",
  "sendUserMessage",
];

const CHAT_MEMORY_ACTIONS_EXPORTS = [
  "listMemories",
  "requestCreateMemory",
  "requestEditMemory",
  "requestDeleteMemory",
  "confirmMemoryAction",
  "cancelMemoryAction",
];

describe("chat-actions.ts — every exported action checks the session first", () => {
  for (const name of CHAT_ACTIONS_EXPORTS) {
    test(`${name} calls getPresidentSession() before touching Supabase`, () => {
      const body = functionBody(chatActionsSource, name);
      const sessionIndex = body.indexOf("getPresidentSession()");
      const clientIndex = body.indexOf("createSupabaseServerClient()");
      assert.notEqual(sessionIndex, -1, `${name} must call getPresidentSession()`);
      if (clientIndex !== -1) assert.ok(sessionIndex < clientIndex, `${name} must check session before the DB client`);
    });
  }

  test("declares exactly the expected exported action surface (no extra exports)", () => {
    const exported = [...chatActionsSource.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(new Set(exported), new Set(CHAT_ACTIONS_EXPORTS));
  });
});

describe("chat-memory-actions.ts — every exported action checks the session first", () => {
  for (const name of CHAT_MEMORY_ACTIONS_EXPORTS) {
    test(`${name} calls getPresidentSession() before doing anything else`, () => {
      const body = functionBody(chatMemoryActionsSource, name);
      const sessionIndex = body.indexOf("getPresidentSession()");
      assert.notEqual(sessionIndex, -1, `${name} must call getPresidentSession()`);
      // The very first non-trivial statement should be the session check —
      // nothing touching Supabase, the internal trusted module, or a
      // client-supplied confirmation id should run before it.
      const clientIndex = body.indexOf("createSupabaseServerClient()");
      const internalCallIndex = Math.min(
        ...["proposeMemoryAction(", "applyMemoryConfirmation(", "invalidatePendingConfirmation("]
          .map((fn) => body.indexOf(fn))
          .filter((i) => i !== -1),
      );
      if (clientIndex !== -1) assert.ok(sessionIndex < clientIndex);
      if (Number.isFinite(internalCallIndex)) assert.ok(sessionIndex < internalCallIndex);
    });
  }

  test("declares exactly the expected exported action surface (no extra exports)", () => {
    const exported = [...chatMemoryActionsSource.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(new Set(exported), new Set(CHAT_MEMORY_ACTIONS_EXPORTS));
  });
});

describe("sendUserMessage — role and structured are never taken from the caller", () => {
  test("the insert hardcodes role: \"user\" and structured: null", () => {
    const body = functionBody(chatActionsSource, "sendUserMessage");
    assert.match(body, /role:\s*"user"/);
    assert.match(body, /structured:\s*null/);
  });

  test("its own parameters are the conversation id and raw content only — nothing for role, structured, creator, or timestamps", () => {
    const signature = chatActionsSource.match(/export async function sendUserMessage\(([^)]*)\)/)?.[1] ?? "";
    assert.match(signature, /rawConversationId/);
    assert.match(signature, /rawContent/);
    assert.doesNotMatch(signature.toLowerCase(), /role|structured|creat|email|timestamp/);
  });
});

describe("confirmMemoryAction / cancelMemoryAction — the click can only ever name which proposal, never what it does", () => {
  test("confirmMemoryAction takes only a confirmationId, no replacement operation data", () => {
    const signature = chatMemoryActionsSource.match(/export async function confirmMemoryAction\(([^)]*)\)/)?.[1] ?? "";
    assert.match(signature.replace(/\s/g, ""), /^confirmationId:string$/);
  });

  test("cancelMemoryAction takes only a confirmationId", () => {
    const signature = chatMemoryActionsSource.match(/export async function cancelMemoryAction\(([^)]*)\)/)?.[1] ?? "";
    assert.match(signature.replace(/\s/g, ""), /^confirmationId:string$/);
  });
});

describe("the trusted assistant-message boundary is not client-callable", () => {
  test("chat-assistant-internal.ts has no \"use server\" directive", () => {
    assert.doesNotMatch(stripComments(chatInternalSource), /"use server"/);
  });

  test("chat-assistant-internal.ts is marked server-only", () => {
    assert.match(chatInternalSource, /import\s+"server-only"/);
  });

  test("no component under src/components imports the internal trusted module", () => {
    const componentFiles = listFilesRecursive("src/components");
    for (const file of componentFiles) {
      const source = read(file);
      assert.doesNotMatch(source, /chat-assistant-internal/, `${file} must not import the trusted internal module`);
    }
  });

  test("only chat-memory-actions.ts imports the internal trusted module (chat-actions.ts does not need it)", () => {
    assert.doesNotMatch(chatActionsSource, /chat-assistant-internal/);
    assert.match(chatMemoryActionsSource, /chat-assistant-internal/);
  });
});

describe("service-role access to chat tables is confined to the trusted internal module", () => {
  test("chat-actions.ts never uses the service-role client", () => {
    assert.doesNotMatch(chatActionsSource, /createSupabaseServiceClient/);
  });

  test("chat-memory-actions.ts never uses the service-role client directly (it goes through the internal module)", () => {
    assert.doesNotMatch(chatMemoryActionsSource, /createSupabaseServiceClient/);
  });

  test("chat-memory-actions.ts never writes to chat_memories directly — every mutation goes through the confirm/propose path", () => {
    assert.doesNotMatch(chatMemoryActionsSource, /from\("chat_memories"\)\.(insert|update|delete)/);
  });

  test("chat-assistant-internal.ts writes only through the service-role RPC functions, never a raw insert into chat_messages or chat_pending_confirmations", () => {
    assert.doesNotMatch(chatInternalSource, /from\("chat_messages"\)\.insert/);
    assert.doesNotMatch(chatInternalSource, /from\("chat_pending_confirmations"\)\.insert/);
    assert.match(chatInternalSource, /\.rpc\("insert_chat_assistant_message"/);
    assert.match(chatInternalSource, /\.rpc\("create_chat_pending_confirmation"/);
    assert.match(chatInternalSource, /\.rpc\("apply_chat_memory_confirmation"/);
  });
});

describe("no Groq call anywhere in Stage 2", () => {
  for (const [label, source] of [
    ["chat-actions.ts", chatActionsSource],
    ["chat-memory-actions.ts", chatMemoryActionsSource],
    ["chat-assistant-internal.ts", chatInternalSource],
  ] as const) {
    test(`${label} does not import or call anything Groq-related`, () => {
      assert.doesNotMatch(source, /groq/i);
    });
  }
});
