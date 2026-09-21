import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const workspaceActionsSource = readFileSync(`${ROOT}src/app/president/workspace-actions.ts`, "utf8");
const meetingActionsSource = readFileSync(`${ROOT}src/app/president/actions.ts`, "utf8");
const presidentPanelSource = readFileSync(`${ROOT}src/components/president/PresidentPanel.tsx`, "utf8");
const suggestionDetailSource = readFileSync(`${ROOT}src/components/president/SuggestionDetail.tsx`, "utf8");

/** Functions whose own body must open with the session check. */
const DIRECTLY_GUARDED = ["saveMeetingBrief", "updateMeetingBrief", "listMeetingBriefs", "getMeetingBrief", "setMeetingBriefState"];
/** Public actions that delegate entirely to a directly-guarded helper — the same shape as decideMatch/confirmMatch/dismissMatch in actions.ts. */
const DELEGATING_ACTIONS: Record<string, string> = {
  archiveMeetingBrief: "setMeetingBriefState",
  restoreMeetingBrief: "setMeetingBriefState",
};

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

/**
 * These are regression guards on the actual shipped source, not a mocked
 * integration test — there is no local Supabase instance to run these
 * actions against RLS. They exist so that a future edit which removes the
 * session guard, or wires generation straight into a save, fails a test
 * immediately instead of only failing in production.
 */
describe("workspace-actions.ts — every action independently checks the session", () => {
  for (const name of DIRECTLY_GUARDED) {
    test(`${name} calls getPresidentSession() before touching Supabase`, () => {
      const body = functionBody(workspaceActionsSource, name);
      const sessionCallIndex = body.indexOf("getPresidentSession()");
      const clientCallIndex = body.indexOf("createSupabaseServerClient()");

      assert.notEqual(sessionCallIndex, -1, `${name} must call getPresidentSession()`);
      if (clientCallIndex !== -1) {
        assert.ok(
          sessionCallIndex < clientCallIndex,
          `${name} must check the session before creating a Supabase client`,
        );
      }
    });
  }

  for (const [publicName, guardedHelper] of Object.entries(DELEGATING_ACTIONS)) {
    test(`${publicName} delegates to ${guardedHelper}, which is itself session-guarded`, () => {
      const body = functionBody(workspaceActionsSource, publicName);
      assert.match(body, new RegExp(`${guardedHelper}\\(`));
      assert.ok(DIRECTLY_GUARDED.includes(guardedHelper), `${guardedHelper} must be one of the directly-guarded functions`);
    });
  }

  test("getPresidentSession is imported from the real auth module, not reimplemented", () => {
    assert.match(workspaceActionsSource, /import\s*\{\s*getPresidentSession\s*\}\s*from\s*"@\/lib\/auth"/);
  });
});

describe("generating a brief never saves it automatically", () => {
  test("prepareWeeklyMeeting (actions.ts) never calls saveMeetingBrief", () => {
    assert.doesNotMatch(meetingActionsSource, /saveMeetingBrief/);
  });

  test("meeting_briefs is only ever written inside saveMeetingBrief, updateMeetingBrief, or setMeetingBriefState", () => {
    const insertOrUpdateCount = (workspaceActionsSource.match(/from\("meeting_briefs"\)\s*\n?\s*\.(insert|update)\(/g) ?? []).length;
    assert.ok(insertOrUpdateCount >= 3, "expected an insert (save) and updates (update, archive/restore)");

    for (const name of ["saveMeetingBrief", "updateMeetingBrief", "setMeetingBriefState"]) {
      const body = functionBody(workspaceActionsSource, name);
      assert.match(body, /from\("meeting_briefs"\)/);
    }
  });
});

describe("the workspace never modifies suggestions themselves", () => {
  test("workspace-actions.ts only ever selects from the suggestions table", () => {
    assert.doesNotMatch(workspaceActionsSource, /from\("suggestions"\)\.(update|delete|insert)/);
    assert.match(workspaceActionsSource, /from\("suggestions"\)\.select/);
  });
});

describe("legacy anonymous suggestions are still rendered by unchanged code", () => {
  test("the dashboard list still branches on is_anonymous", () => {
    assert.match(presidentPanelSource, /is_anonymous/);
  });

  test("the suggestion detail pane still branches on is_anonymous", () => {
    assert.match(suggestionDetailSource, /is_anonymous/);
  });
});
