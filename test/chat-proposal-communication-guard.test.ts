import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

for (const [file, fnName, groqFnName] of [
  ["src/app/president/chat-proposal-builder.ts", "buildProposalDraft", "generateAnswerCompletion"],
  ["src/app/president/chat-communication-draft.ts", "buildCommunicationDraft", "generateAnswerCompletion"],
] as const) {
  describe(`${file} — same citation-allowlist boundary as chat-inbox-answer.ts`, () => {
    const source = read(file);

    test("is NOT a Server Action and is marked server-only", () => {
      assert.doesNotMatch(stripComments(source), /"use server"/);
      assert.match(source, /import\s+"server-only"/);
    });

    test(`${fnName} never calls getPresidentSession() itself — identity must come from the caller`, () => {
      assert.doesNotMatch(stripComments(source), /getPresidentSession\(/);
    });

    test(`${fnName}'s first parameter is an already-verified session`, () => {
      const signature = source.match(new RegExp(`export async function ${fnName}\\(([^)]*)`))?.[1] ?? "";
      assert.match(signature, /session:\s*PresidentSession/);
    });

    test(`calls ${groqFnName} exactly once per draft — no loop, no unbounded retry`, () => {
      const occurrences = (source.match(new RegExp(`${groqFnName}\\(`, "g")) ?? []).length;
      assert.equal(occurrences, 1);
    });

    test("checks a per-president rate limit before ever calling Groq", () => {
      const body = functionBody(source, fnName);
      const rateLimitIndex = body.indexOf("checkChatRateLimit(");
      const groqIndex = body.indexOf(`${groqFnName}(`);
      assert.notEqual(rateLimitIndex, -1);
      assert.ok(rateLimitIndex < groqIndex);
    });

    test("every citation is validated with allCitationsAllowed before a structured draft can be built", () => {
      const body = functionBody(source, fnName);
      const allowlistIndex = body.indexOf("allCitationsAllowed(");
      const structuredIndex = body.indexOf("const structured:");
      assert.notEqual(allowlistIndex, -1);
      assert.notEqual(structuredIndex, -1);
      assert.ok(allowlistIndex < structuredIndex, "citation validation must happen before the structured draft is built");
    });

    test("a draft that fails citation validation returns structured: null, never the untrusted content", () => {
      const body = functionBody(source, fnName);
      const failBlock = body.match(/if \(!allCitationsAllowed\([^)]*\)\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
      assert.notEqual(failBlock, "");
      assert.match(failBlock, /structured:\s*null/);
      assert.doesNotMatch(failBlock, /content:\s*outcome\.content/);
    });

    test("only fields already in SearchableSuggestion (no student_name/student_email) are ever selected", () => {
      assert.doesNotMatch(source, /student_name|student_email/);
    });

    test("never uses the service-role client", () => {
      assert.doesNotMatch(source, /createSupabaseServiceClient/);
    });

    test("nothing here writes to any table — read-only Supabase access, plus draft text only", () => {
      assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
    });
  });
}

describe("chat-communication-draft.ts — no send capability anywhere", () => {
  const source = read("src/app/president/chat-communication-draft.ts");

  test("no fetch, email, or webhook call to an external delivery endpoint", () => {
    assert.doesNotMatch(stripComments(source), /\bfetch\(|resend|sendgrid|nodemailer|smtp/i);
  });

  test("an unrecognized kind falls back to a safe default rather than throwing or guessing at intent", () => {
    assert.match(source, /DEFAULT_KIND/);
    assert.match(source, /COMMUNICATION_DRAFT_KINDS as readonly string\[\]\)\.includes/);
  });
});

describe("chat-proposal-builder.ts — no cost/budget field anywhere in what it builds", () => {
  const source = read("src/app/president/chat-proposal-builder.ts");

  test("never references a cost, budget, price, or dollar field", () => {
    assert.doesNotMatch(source.toLowerCase(), /\bcost\b|\bbudget\b|\bprice\b|\bdollar/);
  });
});
