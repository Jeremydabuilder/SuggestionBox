import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("agent-home-actions.ts — the home briefing never calls Groq", () => {
  const source = read("src/app/president/agent-home-actions.ts");

  test("is a Server Action and checks the session first", () => {
    assert.match(stripComments(source), /"use server"/);
    const sessionIndex = source.indexOf("getPresidentSession()");
    const clientIndex = source.indexOf("createSupabaseServerClient()");
    assert.notEqual(sessionIndex, -1);
    assert.ok(sessionIndex < clientIndex);
  });

  test("no Groq call anywhere", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });

  test("only ever selects — no insert, update, or delete", () => {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });

  test("never uses the service-role client", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });

  test("never selects student_name or student_email", () => {
    assert.doesNotMatch(stripComments(source), /student_name|student_email/);
  });
});

describe("AIChat.tsx — page load / conversation open triggers zero Groq calls", () => {
  const source = read("src/components/president/AIChat.tsx");

  test("the two mount-time effects (agent name, home briefing) call only listMemories and getAgentHomeBriefing — both zero-Groq reads", () => {
    assert.doesNotMatch(stripComments(source), /\bgroq\b/i);
  });

  test("useEffect for the agent name and the home briefing each run once on mount (empty dependency array), never on an interval", () => {
    const occurrences = (source.match(/}, \[\]\);/g) ?? []).length;
    assert.ok(occurrences >= 2, "expected at least the two mount-only effects (agent name, home briefing)");
  });

  test("no setInterval/setTimeout polling loop anywhere that could call a server action in the background", () => {
    assert.doesNotMatch(source, /setInterval\(/);
  });
});

describe("AgentSettingsPanel.tsx — settings changes go through the existing memory confirmation flow, never a direct write", () => {
  const source = read("src/components/president/AgentSettingsPanel.tsx");

  test("never imports a Supabase client or the service-role helper", () => {
    assert.doesNotMatch(source, /createSupabaseServerClient|createSupabaseServiceClient/);
  });

  test("every proposed change goes through requestCreateMemory/requestEditMemory/requestDeleteMemory, and applies only through confirmMemoryAction", () => {
    assert.match(source, /requestCreateMemory\(/);
    assert.match(source, /requestEditMemory\(/);
    assert.match(source, /requestDeleteMemory\(/);
    assert.match(source, /confirmMemoryAction\(/);
  });

  test("the confirm() function is the only place that clears `pending` after a successful apply, and it does so only after confirmMemoryAction succeeds", () => {
    const start = source.indexOf("async function confirm(");
    const body = source.slice(start, source.indexOf("\n\n", start));
    const confirmCallIndex = body.indexOf("confirmMemoryAction(");
    const clearIndex = body.indexOf("setPending(null);");
    assert.notEqual(confirmCallIndex, -1);
    assert.notEqual(clearIndex, -1);
    assert.ok(confirmCallIndex < clearIndex, "must call confirmMemoryAction before clearing the pending state");
  });

  test("never writes memory directly — no chat_memories reference outside a comment", () => {
    assert.doesNotMatch(stripComments(source), /chat_memories/);
  });

  test("contains no secret, API key, or service-role setting outside a comment", () => {
    assert.doesNotMatch(stripComments(source).toLowerCase(), /api[_-]?key|service[_-]?role|secret/);
  });
});
