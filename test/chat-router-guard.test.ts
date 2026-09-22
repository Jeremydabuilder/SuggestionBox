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

  test("as of Stage 9, 15 of the 17 intents are marked implemented — only suggestion_details and related_suggestions remain planned (no durable cross-turn S### ref resolution yet)", () => {
    const implemented = Object.values(CHAT_TOOL_REGISTRY).filter((entry) => entry.status === "implemented").map((e) => e.intent);
    assert.deepEqual(
      new Set(implemented),
      new Set([
        "help",
        "clarification_needed",
        "memory_manager",
        "meeting_prep",
        "meeting_history",
        "list_decisions",
        "list_actions",
        "since_last_meeting",
        "search_inbox",
        "trend_radar",
        "promise_tracker",
        "general_workspace_question",
        "proposal_builder",
        "draft_communication",
        "meeting_cleanup",
      ]),
    );
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

  test("since_last_meeting returns an honest routing signal, never a fabricated report — the real report is built by since-last-meeting-actions.ts, not executeRoute", () => {
    const withoutMeeting: RouteDecision = { intent: "since_last_meeting", args: parseIntentArgs("since_last_meeting", {}), confidence: "high", needsClarification: false, source: "deterministic" };
    const r1 = executeRoute(withoutMeeting);
    assert.equal(r1.status, "ok");
    if (r1.status === "ok" && r1.kind === "since_last_meeting") assert.equal(r1.meetingId, null);

    const meetingId = "11111111-1111-4111-8111-111111111111";
    const withMeeting: RouteDecision = { intent: "since_last_meeting", args: parseIntentArgs("since_last_meeting", { meetingId }), confidence: "high", needsClarification: false, source: "deterministic" };
    const r2 = executeRoute(withMeeting);
    assert.equal(r2.status, "ok");
    if (r2.status === "ok" && r2.kind === "since_last_meeting") assert.equal(r2.meetingId, meetingId);
  });

  test("search_inbox, trend_radar, promise_tracker, and general_workspace_question return honest routing signals, never fabricated results — the real reads happen in their own server actions, not executeRoute", () => {
    const search: RouteDecision = { intent: "search_inbox", args: parseIntentArgs("search_inbox", { query: "lunch", category: "food" }), confidence: "high", needsClarification: false, source: "deterministic" };
    const searchResult = executeRoute(search);
    assert.equal(searchResult.status, "ok");
    if (searchResult.status === "ok" && searchResult.kind === "search_inbox") {
      assert.equal(searchResult.query, "lunch");
      assert.equal(searchResult.category, "food");
    }

    const trend: RouteDecision = { intent: "trend_radar", args: parseIntentArgs("trend_radar", {}), confidence: "high", needsClarification: false, source: "deterministic" };
    const trendResult = executeRoute(trend);
    assert.equal(trendResult.status, "ok");
    if (trendResult.status === "ok") assert.equal(trendResult.kind, "trend_radar");

    const promise: RouteDecision = { intent: "promise_tracker", args: parseIntentArgs("promise_tracker", {}), confidence: "high", needsClarification: false, source: "deterministic" };
    const promiseResult = executeRoute(promise);
    assert.equal(promiseResult.status, "ok");
    if (promiseResult.status === "ok") assert.equal(promiseResult.kind, "promise_tracker");

    const question: RouteDecision = { intent: "general_workspace_question", args: parseIntentArgs("general_workspace_question", { query: "what's popular?" }), confidence: "medium", needsClarification: false, source: "ai" };
    const questionResult = executeRoute(question);
    assert.equal(questionResult.status, "ok");
    if (questionResult.status === "ok" && questionResult.kind === "general_workspace_question") {
      assert.equal(questionResult.query, "what's popular?");
    }
  });

  test("proposal_builder and draft_communication return honest routing signals, never fabricated drafts — the real drafting happens in their own server-only modules, not executeRoute", () => {
    const proposal: RouteDecision = { intent: "proposal_builder", args: parseIntentArgs("proposal_builder", { topic: "recycling" }), confidence: "high", needsClarification: false, source: "deterministic" };
    const proposalResult = executeRoute(proposal);
    assert.equal(proposalResult.status, "ok");
    if (proposalResult.status === "ok" && proposalResult.kind === "proposal_builder") assert.equal(proposalResult.topic, "recycling");

    const comm: RouteDecision = { intent: "draft_communication", args: parseIntentArgs("draft_communication", { kind: "meeting_recap", topic: "lunch" }), confidence: "high", needsClarification: false, source: "deterministic" };
    const commResult = executeRoute(comm);
    assert.equal(commResult.status, "ok");
    if (commResult.status === "ok" && commResult.kind === "draft_communication") {
      assert.equal(commResult.commKind, "meeting_recap");
      assert.equal(commResult.topic, "lunch");
    }
  });

  test("meeting_cleanup opens the recorder panel — no transcriptRef resolution happens in executeRoute", () => {
    const decision: RouteDecision = { intent: "meeting_cleanup", args: parseIntentArgs("meeting_cleanup", { transcriptRef: "whatever" }), confidence: "high", needsClarification: false, source: "deterministic" };
    const result = executeRoute(decision);
    assert.equal(result.status, "ok");
    if (result.status === "ok") assert.equal(result.kind, "meeting_cleanup");
  });

  test("meeting_prep, meeting_history, list_decisions, and list_actions each return the panel-open kind matching their intent name, not a fabricated record", () => {
    const cases: Array<[typeof CHAT_INTENTS[number], "meeting_prep" | "meeting_history" | "list_decisions" | "list_actions"]> = [
      ["meeting_prep", "meeting_prep"],
      ["meeting_history", "meeting_history"],
      ["list_decisions", "list_decisions"],
      ["list_actions", "list_actions"],
    ];
    for (const [intent, kind] of cases) {
      const decision: RouteDecision = { intent, args: parseIntentArgs(intent, defaultArgsFor(intent)), confidence: "high", needsClarification: false, source: "deterministic" };
      const result = executeRoute(decision);
      assert.equal(result.status, "ok");
      if (result.status === "ok") assert.equal(result.kind, kind);
    }
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
    assert.equal(execution.status, "ok"); // list_actions is connected as of Stage 5, but routing itself was deterministic
    if (execution.status === "ok") assert.equal(execution.kind, "list_actions");
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

describe("Stage 5 tool panels — chat opens the door, it never mutates anything itself", () => {
  const aiChatSource = read("src/components/president/AIChat.tsx");

  test("AIChat.tsx never imports a Supabase client or a service-role helper", () => {
    assert.doesNotMatch(aiChatSource, /createSupabaseServerClient|createSupabaseServiceClient/);
  });

  test("AIChat.tsx never calls a decision/action/meeting-brief mutation directly — those stay inside DecisionLog/ActionItems/MeetingAgent", () => {
    assert.doesNotMatch(aiChatSource, /createDecision|updateDecision|deleteDecision|createActionItem|updateActionItem|setActionItemCompleted|deleteActionItem|saveMeetingBrief|updateMeetingBrief|archiveMeetingBrief|restoreMeetingBrief/);
  });

  test("the workspace panels it renders are the same pre-existing, already-tested components — not new ones", () => {
    assert.match(aiChatSource, /import MeetingAgent from ".\/MeetingAgent"/);
    assert.match(aiChatSource, /import MeetingHistory from ".\/MeetingHistory"/);
    assert.match(aiChatSource, /import DecisionLog, \{ type PrefillDecision \} from ".\/DecisionLog"/);
    assert.match(aiChatSource, /import ActionItems, \{ type PrefillAction \} from ".\/ActionItems"/);
    assert.match(aiChatSource, /import RecorderCleanupPanel from ".\/RecorderCleanupPanel"/);
  });
});

describe("RecorderCleanupPanel.tsx — Stage 9's recorder never mutates workspace data itself", () => {
  const recorderSource = read("src/components/president/RecorderCleanupPanel.tsx");

  test("never imports a Supabase client or a service-role helper", () => {
    assert.doesNotMatch(recorderSource, /createSupabaseServerClient|createSupabaseServiceClient/);
  });

  test("never calls a decision/action mutation directly — hands off via onAddDecision/onAddAction instead", () => {
    assert.doesNotMatch(recorderSource, /createDecision|updateDecision|deleteDecision|createActionItem|updateActionItem|setActionItemCompleted|deleteActionItem/);
    assert.match(recorderSource, /onAddDecision\(/);
    assert.match(recorderSource, /onAddAction\(/);
  });

  test("never writes to localStorage, sessionStorage, or IndexedDB — audio and transcript state is React state only", () => {
    assert.doesNotMatch(recorderSource, /localStorage|sessionStorage|indexedDB/i);
  });

  test("stops every media track it opens (no lingering microphone access)", () => {
    assert.match(recorderSource, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  });

  test("discards the in-memory audio blob as soon as the transcription request completes, success or failure", () => {
    assert.match(recorderSource, /setAudioBlob\(null\); \/\/ discard the in-memory blob/);
  });
});

describe("Stage 10 UX audit — AIChat.tsx no longer force-opens a modal for a plain read", () => {
  const aiChatSource = read("src/components/president/AIChat.tsx");

  test("a chat message classified as meeting_history, list_decisions, or list_actions does not auto-open a panel", () => {
    const start = aiChatSource.indexOf("if (result.data.toolStatus");
    const end = aiChatSource.indexOf("\n    }", start);
    const block = aiChatSource.slice(start, end);
    assert.doesNotMatch(block, /"meeting_history"|"list_decisions"|"list_actions"/);
  });

  test("memory_manager, meeting_prep, and meeting_cleanup still open their panel — only the pure reads changed", () => {
    const start = aiChatSource.indexOf("if (result.data.toolStatus");
    const end = aiChatSource.indexOf("\n    }", start);
    const block = aiChatSource.slice(start, end);
    assert.match(block, /"memory_manager"/);
    assert.match(block, /"meeting_prep"/);
    assert.match(block, /"meeting_cleanup"/);
  });

  test("the three read-only summary cards each offer an 'Open full view' handoff to the existing panel, never a new mutation path", () => {
    assert.match(aiChatSource, /onOpenPanel\("meeting_history"\)/);
    assert.match(aiChatSource, /onOpenPanel\("decisions"\)/);
    assert.match(aiChatSource, /onOpenPanel\("actions"\)/);
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
