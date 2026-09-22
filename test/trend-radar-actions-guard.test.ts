import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/trend-radar-actions.ts");

describe("trend-radar-actions.ts — a read-only, fully deterministic report", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(source), /"use server"/);
  });

  test("declares exactly one exported action", () => {
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(exported, ["getTrendRadar"]);
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

  test("reads only the category and created_at columns from suggestions — no title, body, or student identity", () => {
    assert.match(source, /\.select\("category, created_at"\)/);
  });

  test("no Groq call anywhere — the classifier decision tree is fully deterministic", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });

  test("delegates the actual computation to the pure builder in lib/trend-radar.ts", () => {
    assert.match(source, /buildTrendRadar\(/);
    assert.match(source, /from "@\/lib\/trend-radar"/);
  });
});
