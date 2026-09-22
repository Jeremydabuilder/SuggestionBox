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
    assert.doesNotMatch(stripComments(source), /groq/i);
  });
});

describe("since_last_meeting — the structured report card is built from a real server read, not assembled from routing args", () => {
  test("delegates to getSinceLastMeetingReport rather than constructing the report itself", () => {
    assert.match(source, /getSinceLastMeetingReport\(execution\.meetingId/);
  });

  test("the structured card is only ever set from the report result, never a client- or classifier-supplied value", () => {
    const body = functionBody("sendChatMessage");
    const branchStart = body.indexOf('execution.kind === "since_last_meeting"');
    const branchEnd = body.indexOf('} else if (execution.status === "ok" && execution.kind === "search_inbox")', branchStart);
    const branch = body.slice(branchStart, branchEnd === -1 ? undefined : branchEnd);
    // Every assignment to `structured` in this branch must originate from
    // `reportResult.data.report` (the trusted server read) — never from
    // `decision.args` or raw message text.
    const assignments = [...branch.matchAll(/structured\s*=\s*([^;]+);/g)].map((m) => m[1]!.trim());
    for (const assignment of assignments) {
      assert.match(assignment, /reportResult\.data\.report/, `unexpected structured assignment: ${assignment}`);
    }
    assert.ok(assignments.length > 0);
  });

  test("a failed report read falls back to the report's own error text, not a silent success", () => {
    const body = functionBody("sendChatMessage");
    assert.match(body, /reportResult\.ok/);
    assert.match(body, /reportResult\.error/);
  });
});

describe("Stage 7 — search_inbox, trend_radar, and promise_tracker are deterministic; general_workspace_question is the only branch that calls Groq", () => {
  test("search_inbox, trend_radar, and promise_tracker each delegate to their own read-only server action", () => {
    assert.match(source, /searchInbox\(execution\.query/);
    assert.match(source, /getTrendRadar\(\)/);
    assert.match(source, /getPromiseTracker\(\)/);
  });

  test("general_workspace_question is the only branch calling answerWorkspaceQuestion, and the structured card comes straight from its result", () => {
    const occurrences = (source.match(/answerWorkspaceQuestion\(/g) ?? []).length;
    assert.equal(occurrences, 1);
    assert.match(source, /structured = answer\.structured;/);
  });

  test("this file itself never calls Groq directly — the one model call for Ask the Inbox lives inside chat-inbox-answer.ts", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });
});

describe("Stage 8 — proposal_builder and draft_communication delegate to their own server-only, citation-checked modules", () => {
  test("proposal_builder calls buildProposalDraft exactly once, and its structured card comes straight from the result", () => {
    const occurrences = (source.match(/buildProposalDraft\(/g) ?? []).length;
    assert.equal(occurrences, 1);
    assert.match(source, /structured = proposal\.structured;/);
  });

  test("draft_communication calls buildCommunicationDraft exactly once, and its structured card comes straight from the result", () => {
    const occurrences = (source.match(/buildCommunicationDraft\(/g) ?? []).length;
    assert.equal(occurrences, 1);
    assert.match(source, /structured = draft\.structured;/);
  });
});
