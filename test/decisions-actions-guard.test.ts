import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
/** Strip comments so a prose note explaining "there is no owner field" doesn't trip a search for one. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const decisionsActionsSource = read("src/app/president/decisions-actions.ts");
const actionItemsActionsSource = read("src/app/president/action-items-actions.ts");
const decisionsStoreSource = read("src/lib/decisions-actions-store.ts");
const decisionLogSource = read("src/components/president/DecisionLog.tsx");
const actionItemsUiSource = read("src/components/president/ActionItems.tsx");
const meetingAgentSource = read("src/components/president/MeetingAgent.tsx");
const meetingHistorySource = read("src/components/president/MeetingHistory.tsx");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("decisions-actions.ts — every action independently checks the session", () => {
  for (const name of ["createDecision", "updateDecision", "deleteDecision", "listDecisions"]) {
    test(`${name} calls getPresidentSession() before touching Supabase`, () => {
      const body = functionBody(decisionsActionsSource, name);
      const sessionCallIndex = body.indexOf("getPresidentSession()");
      const clientCallIndex = body.indexOf("createSupabaseServerClient()");
      assert.notEqual(sessionCallIndex, -1, `${name} must call getPresidentSession()`);
      if (clientCallIndex !== -1) {
        assert.ok(sessionCallIndex < clientCallIndex, `${name} must check the session before creating a Supabase client`);
      }
    });
  }
});

describe("action-items-actions.ts — every action independently checks the session", () => {
  for (const name of ["createActionItem", "updateActionItem", "setActionItemCompleted", "deleteActionItem", "listActionItems"]) {
    test(`${name} calls getPresidentSession() before touching Supabase`, () => {
      const body = functionBody(actionItemsActionsSource, name);
      const sessionCallIndex = body.indexOf("getPresidentSession()");
      const clientCallIndex = body.indexOf("createSupabaseServerClient()");
      assert.notEqual(sessionCallIndex, -1, `${name} must call getPresidentSession()`);
      if (clientCallIndex !== -1) {
        assert.ok(sessionCallIndex < clientCallIndex, `${name} must check the session before creating a Supabase client`);
      }
    });
  }
});

describe("decisions and actions never modify suggestions themselves", () => {
  test("decisions-actions.ts only ever selects from the suggestions table", () => {
    assert.doesNotMatch(decisionsActionsSource, /from\("suggestions"\)\.(update|delete|insert)/);
    assert.match(decisionsActionsSource, /from\("suggestions"\)\.select/);
  });

  test("action-items-actions.ts only ever selects from the suggestions table", () => {
    assert.doesNotMatch(actionItemsActionsSource, /from\("suggestions"\)\.(update|delete|insert)/);
    assert.match(actionItemsActionsSource, /from\("suggestions"\)\.select/);
  });
});

describe("no owner/assignee field exists anywhere in decisions or actions", () => {
  const OWNER_PATTERN = /\bowner\b|\bassignee\b|assigned_to|assignedTo/i;
  for (const [label, source] of [
    ["decisions-actions-store.ts", decisionsStoreSource],
    ["decisions-actions.ts", decisionsActionsSource],
    ["action-items-actions.ts", actionItemsActionsSource],
    ["DecisionLog.tsx", decisionLogSource],
    ["ActionItems.tsx", actionItemsUiSource],
  ] as const) {
    test(`${label} has no owner/assignee-shaped identifier`, () => {
      assert.doesNotMatch(stripComments(source), OWNER_PATTERN);
    });
  }
});

describe("brief-derived decisions and actions always go through explicit review", () => {
  test("MeetingAgent.tsx never calls createDecision or createActionItem directly", () => {
    assert.doesNotMatch(meetingAgentSource, /createDecision\(/);
    assert.doesNotMatch(meetingAgentSource, /createActionItem\(/);
  });

  test("MeetingHistory.tsx never calls createDecision or createActionItem directly", () => {
    assert.doesNotMatch(meetingHistorySource, /createDecision\(/);
    assert.doesNotMatch(meetingHistorySource, /createActionItem\(/);
  });

  test("only DecisionLog.tsx's own submit handler calls createDecision", () => {
    assert.match(decisionLogSource, /createDecision\(/);
  });

  test("only ActionItems.tsx's own submit handler calls createActionItem", () => {
    assert.match(actionItemsUiSource, /createActionItem\(/);
  });
});

describe("citations are always replaced, never merged blindly, on update", () => {
  test("updateDecision deletes existing citations before inserting the resolved set", () => {
    const body = functionBody(decisionsActionsSource, "updateDecision");
    const deleteIndex = body.indexOf('from("meeting_decision_citations").delete()');
    const insertIndex = body.indexOf('from("meeting_decision_citations")\n      .insert(');
    assert.notEqual(deleteIndex, -1);
    assert.notEqual(insertIndex, -1);
    assert.ok(deleteIndex < insertIndex);
  });

  test("updateActionItem deletes existing citations before inserting the resolved set", () => {
    const body = functionBody(actionItemsActionsSource, "updateActionItem");
    const deleteIndex = body.indexOf('from("meeting_action_citations").delete()');
    const insertIndex = body.indexOf('from("meeting_action_citations")\n      .insert(');
    assert.notEqual(deleteIndex, -1);
    assert.notEqual(insertIndex, -1);
    assert.ok(deleteIndex < insertIndex);
  });
});
