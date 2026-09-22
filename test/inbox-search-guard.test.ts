import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("inbox-search-actions.ts — deterministic search, no Groq, no PII columns", () => {
  const source = read("src/app/president/inbox-search-actions.ts");

  test("is a Server Action and checks the session first", () => {
    assert.match(stripComments(source), /"use server"/);
    const sessionIndex = source.indexOf("getPresidentSession()");
    const clientIndex = source.indexOf("createSupabaseServerClient()");
    assert.notEqual(sessionIndex, -1);
    assert.ok(sessionIndex < clientIndex);
  });

  test("never selects student_name or student_email", () => {
    assert.doesNotMatch(stripComments(source), /student_name|student_email/);
  });

  test("only ever selects — no insert, update, or delete", () => {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });

  test("no Groq call anywhere — search itself is deterministic", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });

  test("never uses the service-role client", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });
});

describe("trend-radar-actions.ts — deterministic frequency comparison, no Groq", () => {
  const source = read("src/app/president/trend-radar-actions.ts");

  test("is a Server Action and checks the session first", () => {
    assert.match(stripComments(source), /"use server"/);
    const sessionIndex = source.indexOf("getPresidentSession()");
    const clientIndex = source.indexOf("createSupabaseServerClient()");
    assert.notEqual(sessionIndex, -1);
    assert.ok(sessionIndex < clientIndex);
  });

  test("only ever selects — no insert, update, or delete", () => {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });

  test("no Groq call anywhere", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });

  test("never uses the service-role client", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });
});

describe("promise-tracker-actions.ts — deterministic decision/action gap detection, no Groq", () => {
  const source = read("src/app/president/promise-tracker-actions.ts");

  test("is a Server Action and checks the session first", () => {
    assert.match(stripComments(source), /"use server"/);
    const sessionIndex = source.indexOf("getPresidentSession()");
    const clientIndex = source.indexOf("createSupabaseServerClient()");
    assert.notEqual(sessionIndex, -1);
    assert.ok(sessionIndex < clientIndex);
  });

  test("only ever selects — no insert, update, or delete", () => {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
  });

  test("no owner, assignee, or responsibility field is read", () => {
    assert.doesNotMatch(source.toLowerCase(), /owner|assignee|assigned_to/);
  });

  test("no Groq call anywhere", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });

  test("never uses the service-role client", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });
});
