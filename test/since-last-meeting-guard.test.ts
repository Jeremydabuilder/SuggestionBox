import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/since-last-meeting-actions.ts");

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("since-last-meeting-actions.ts — a read-only report, nothing else", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(source), /"use server"/);
  });

  test("declares exactly one exported action", () => {
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(exported, ["getSinceLastMeetingReport"]);
  });

  test("getSinceLastMeetingReport calls getPresidentSession() before touching Supabase", () => {
    const body = functionBody("getSinceLastMeetingReport");
    const sessionIndex = body.indexOf("getPresidentSession()");
    const clientIndex = body.indexOf("createSupabaseServerClient()");
    assert.notEqual(sessionIndex, -1);
    assert.notEqual(clientIndex, -1);
    assert.ok(sessionIndex < clientIndex);
  });

  test("never uses the service-role client — every read goes through the RLS-scoped session client", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });

  test("only ever selects — no insert, update, or delete anywhere in this file", () => {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });

  test("reads the exact tables the report depends on, and nothing else", () => {
    const tables = [...source.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
    assert.deepEqual(new Set(tables), new Set(["meeting_briefs", "suggestions", "status_history", "meeting_decisions", "meeting_actions"]));
  });

  test("no owner, assignee, or responsibility field is read from meeting_actions", () => {
    assert.doesNotMatch(source.toLowerCase(), /owner|assignee|assigned_to/);
  });

  test("no Groq call anywhere — the report is fully deterministic", () => {
    assert.doesNotMatch(source, /groq/i);
  });

  test("the meetingId argument, when provided, is validated against a UUID pattern before use", () => {
    const body = functionBody("getSinceLastMeetingReport");
    assert.match(body, /UUID_RE\.test\(rawMeetingId\)/);
  });

  test("delegates the actual computation to the pure builder in lib/since-last-meeting.ts", () => {
    assert.match(source, /buildSinceLastMeetingReport\(/);
    assert.match(source, /from "@\/lib\/since-last-meeting"/);
  });
});
