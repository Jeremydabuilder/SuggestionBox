import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/clusters-actions.ts");

describe("clusters-actions.ts — a read-only, fully deterministic report", () => {
  test("is a Server Action", () => {
    assert.match(stripComments(source), /"use server"/);
  });

  test("declares exactly one exported action", () => {
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(exported, ["getSuggestionClusters"]);
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

  test("dismissed matches are never fetched", () => {
    assert.match(source, /\.neq\("state", "dismissed"\)/);
  });

  test("archived suggestions are excluded from cluster membership", () => {
    assert.match(source, /\.neq\("status", "archived"\)/);
  });

  test("suggestion rows carry only id, title, category, and status — no body, no student identity", () => {
    assert.match(source, /\.select\("id, title, category, status"\)/);
  });

  test("no Groq call anywhere — clustering is pure graph connected-components on stored match rows", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });

  test("delegates the actual grouping to the pure builder in lib/duplicates/clustering.ts", () => {
    assert.match(source, /buildSuggestionClusters\(/);
    assert.match(source, /from "@\/lib\/duplicates\/clustering"/);
  });
});
