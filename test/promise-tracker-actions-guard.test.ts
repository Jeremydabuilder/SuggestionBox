import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/promise-tracker-actions.ts");

describe("promise-tracker-actions.ts — a read-only, fully deterministic report", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(source), /"use server"/);
  });

  test("declares exactly one exported action", () => {
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(exported, ["getPromiseTracker"]);
  });

  test("checks getPresidentSession() before touching Supabase", () => {
    const sessionIndex = source.indexOf("getPresidentSession()");
    const clientIndex = source.indexOf("createSupabaseServerClient()");
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
    assert.deepEqual(
      new Set(tables),
      new Set(["meeting_decisions", "meeting_actions", "suggestions", "meeting_action_citations", "meeting_briefs"]),
    );
  });

  test("only approved suggestions are fetched for the suggestion-gap check", () => {
    assert.match(source, /\.eq\("status", "approved"\)/);
  });

  test("no owner, assignee, or responsibility field is read from meeting_actions", () => {
    assert.doesNotMatch(source.toLowerCase(), /owner|assignee|assigned_to/);
  });

  test("no Groq call anywhere — the report is fully deterministic", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });

  test("delegates the actual computation to the pure builder in lib/promise-tracker.ts", () => {
    assert.match(source, /buildPromiseTracker\(/);
    assert.match(source, /from "@\/lib\/promise-tracker"/);
  });
});
