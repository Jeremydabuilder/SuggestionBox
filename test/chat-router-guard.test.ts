import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHAT_TOOL_REGISTRY, executeRoute } from "../src/app/president/chat-tool-registry.ts";
import { routeDeterministically } from "../src/lib/chat-router-deterministic.ts";
import { CHAT_INTENTS, parseIntentArgs, type RouteDecision } from "../src/lib/chat-intents.ts";

/**
 * chat-router.ts itself keeps `import "server-only"` (it touches
 * serverEnv/Groq indirectly) and is deliberately never imported directly
 * here — same convention this codebase already uses for auth.ts and
 * rate-limit.ts: exercised via source inspection below, not execution.
 * Its constituent pieces (routeDeterministically, parseClassifierOutput,
 * executeRoute) are each directly, behaviorally tested in their own files;
 * together they cover the logic chat-router.ts only wires together.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(`${ROOT}${dir}`, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listFilesRecursive(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const routerSource = read("src/app/president/chat-router.ts");
const registrySource = read("src/app/president/chat-tool-registry.ts");

describe("registry safety boundary", () => {
  test("every one of the 17 intents has exactly one registry entry", () => {
    assert.deepEqual(new Set(Object.keys(CHAT_TOOL_REGISTRY)), new Set(CHAT_INTENTS));
  });

  test("as of Stage 4, only 'help', 'clarification_needed', and 'memory_manager' are marked implemented", () => {
    const implemented = Object.values(CHAT_TOOL_REGISTRY).filter((entry) => entry.status === "implemented").map((e) => e.intent);
    assert.deepEqual(new Set(implemented), new Set(["help", "clarification_needed", "memory_manager"]));
  });

  test("the registry file has no generic SQL, HTTP, shell, or dynamic-import capability", () => {
    const body = stripComments(registrySource);
    assert.doesNotMatch(body, /\bexec\(|\bchild_process\b|\brequire\(|\bimport\(/);
    assert.doesNotMatch(body, /generic.*sql|generic.*http|arbitrary.*table|arbitrary.*mutation/i);
  });

  test("registry authLevel is always 'president' — nothing is world-readable", () => {
    for (const entry of Object.values(CHAT_TOOL_REGISTRY)) assert.equal(entry.authLevel, "president");
  });

  test("no src/components file imports the registry or the router", () => {
    for (const file of listFilesRecursive("src/components")) {
      const source = read(file);
      assert.doesNotMatch(source, /chat-tool-registry/, `${file} must not import the registry`);
      assert.doesNotMatch(source, /chat-router["']/, `${file} must not import the router`);
    }
  });
});

describe("executeRoute — honest results, never a fake record", () => {
  test("help returns its deterministic message", () => {
    const decision: RouteDecision = { intent: "help", args: parseIntentArgs("help", {}), confidence: "high", needsClarification: false, source: "deterministic" };
    const result = executeRoute(decision);
    assert.equal(result.status, "ok");
    if (result.status === "ok") assert.equal(result.kind, "help");
  });

  test("clarification_needed returns the question, not an error", () => {
    const decision: RouteDecision = {
      intent: "clarification_needed",
      args: parseIntentArgs("clarification_needed", { question: "Which meeting?" }),
      confidence: "low",
      needsClarification: true,
      clarificationQuestion: "Which meeting?",
      source: "deterministic",
    };
    const result = executeRoute(decision);
    assert.equal(result.status, "ok");
    if (result.status === "ok" && result.kind === "clarification") assert.equal(result.question, "Which meeting?");
  });

  test("every intent marked planned or not_connected returns not_available, never a fake success", () => {
    for (const intent of CHAT_INTENTS) {
      const entry = CHAT_TOOL_REGISTRY[intent];
      if (entry.status === "implemented") continue;
      const decision: RouteDecision = { intent, args: parseIntentArgs(intent, defaultArgsFor(intent)), confidence: "medium", needsClarification: false, source: "deterministic" };
      const result = executeRoute(decision);
      assert.equal(result.status, "not_available", `${intent} should be honestly not_available`);
    }
  });
});

function defaultArgsFor(intent: (typeof CHAT_INTENTS)[number]): unknown {
  if (intent === "related_suggestions") return { ref: "S001" };
  if (intent === "suggestion_details") return { ref: "S001" };
  if (intent === "general_workspace_question") return { query: "test" };
  if (intent === "clarification_needed") return { question: "test?" };
  return {};
}

describe("chat-router.ts — identity boundary and single-call discipline", () => {
  test("is server-only, not a Server Action", () => {
    assert.match(routerSource, /import\s+"server-only"/);
    assert.doesNotMatch(stripComments(routerSource), /"use server"/);
  });

  test("never calls getPresidentSession() itself — identity must come from the caller", () => {
    assert.doesNotMatch(stripComments(routerSource), /getPresidentSession\(/);
  });

  test("routeChatMessage's first parameter is an already-verified session, not a claimed identity string", () => {
    const signature = routerSource.match(/export async function routeChatMessage\(([^)]*)/)?.[1] ?? "";
    assert.match(signature, /session:\s*PresidentSession/);
  });

  test("chat-router.ts calls the bounded classifier completion exactly once per routing attempt — no loop around it", () => {
    const occurrences = (routerSource.match(/generateClassifierCompletion\(/g) ?? []).length;
    assert.equal(occurrences, 1);
  });

  test("every logged route carries the exact Groq request count", () => {
    assert.match(routerSource, /groq_request_count/);
  });
});

describe("the pieces chat-router.ts wires together behave correctly on their own", () => {
  // chat-router.ts's job is: try routeDeterministically first, and only
  // fall back to the AI classifier (parseClassifierOutput + executeRoute)
  // when that returns null. Each piece is independently, behaviorally
  // tested (chat-router-deterministic.test.ts, chat-classifier.test.ts,
  // and the executeRoute tests above) — this just confirms the handoff
  // contract chat-router.ts relies on still holds.
  test("a deterministic command resolves without needing the classifier at all", () => {
    const result = routeDeterministically("Show open action items");
    assert.notEqual(result, null);
    assert.equal(result!.source, "deterministic");
    const execution = executeRoute(result!);
    assert.equal(execution.status, "not_available"); // list_actions isn't connected yet, but routing itself was deterministic
  });

  test("help resolves deterministically and executes immediately", () => {
    const result = routeDeterministically("help");
    assert.notEqual(result, null);
    const execution = executeRoute(result!);
    assert.equal(execution.status, "ok");
  });

  test("ordinary conversational text returns null from the deterministic router — exactly what tells chat-router.ts to fall back to the classifier", () => {
    assert.equal(routeDeterministically("thanks, that was really helpful today"), null);
  });
});

describe("no logging of message content — only the documented safe metadata fields", () => {
  test("the RouteMetadata type itself has no field for message, context, or model output", () => {
    const interfaceBody = routerSource.match(/export interface RouteMetadata \{([\s\S]*?)\}/)?.[1] ?? "";
    assert.notEqual(interfaceBody, "");
    assert.doesNotMatch(interfaceBody, /message|context|content|response/i);
  });

  test("console.info is only ever called once, logging a fixed label plus the typed meta object — nothing else", () => {
    const calls = [...routerSource.matchAll(/console\.info\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    assert.equal(calls.length, 1);
    assert.equal(calls[0], '"[chat-router]", meta');
  });
});
