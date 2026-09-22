import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = read("src/app/president/trash-actions.ts");
const trashLibSource = read("src/lib/trash.ts");
const migration = read("supabase/migrations/20260926000000_trash.sql");

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextExport = source.indexOf("\nexport", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("trash-actions.ts — every action independently checks the session", () => {
  for (const name of [
    "listTrash",
    "moveToTrash",
    "restoreFromTrash",
    "getDeletionDependencyPreview",
    "requestPermanentDeletion",
    "confirmPermanentDeletion",
  ]) {
    test(`${name} calls getPresidentSession() before touching Supabase`, () => {
      const body = functionBody(name);
      const sessionIndex = body.indexOf("getPresidentSession()");
      const clientIndex = body.indexOf("createSupabaseServerClient()");
      assert.notEqual(sessionIndex, -1, `${name} must call getPresidentSession()`);
      assert.notEqual(clientIndex, -1, `${name} must use the session-scoped client`);
      assert.ok(sessionIndex < clientIndex, `${name} must check the session before creating a Supabase client`);
    });
  }

  test("is a Server Action", () => {
    assert.match(stripComments(source), /"use server"/);
  });

  test("never uses the service-role client — every mutation goes through a SECURITY DEFINER RPC, not an elevated app-side client", () => {
    assert.doesNotMatch(source, /createSupabaseServiceClient/);
  });

  test("no direct write to the suggestions table — trash/restore/delete only ever happen via supabase.rpc(...)", () => {
    assert.doesNotMatch(source, /\.from\("suggestions"\)\s*\.(insert|update|delete|upsert)\(/);
  });

  test("moveToTrash and restoreFromTrash and confirmPermanentDeletion call the expected RPC and nothing else mutating", () => {
    assert.match(source, /\.rpc\("trash_suggestion"/);
    assert.match(source, /\.rpc\("restore_suggestion"/);
    assert.match(source, /\.rpc\("request_suggestion_deletion"/);
    assert.match(source, /\.rpc\("confirm_suggestion_deletion"/);
  });

  test("every suggestion id argument is validated against a UUID pattern before use", () => {
    for (const name of ["moveToTrash", "restoreFromTrash", "getDeletionDependencyPreview", "requestPermanentDeletion"]) {
      const body = functionBody(name);
      assert.match(body, /UUID_RE\.test\(id\)/, `${name} must validate its id argument`);
    }
  });

  test("requestPermanentDeletion re-validates the typed confirmation phrase server-side before requesting a token", () => {
    const body = functionBody("requestPermanentDeletion");
    const phraseCheckIndex = body.indexOf("expectedPhrase");
    const rpcIndex = body.indexOf('.rpc("request_suggestion_deletion"');
    assert.notEqual(phraseCheckIndex, -1);
    assert.notEqual(rpcIndex, -1);
    assert.ok(phraseCheckIndex < rpcIndex, "the phrase must be checked before the token is requested");
  });

  test("the typed confirmation phrase is derived from the suggestion id (first 8 hex chars, uppercased), not a client-supplied value", () => {
    assert.match(trashLibSource, /suggestionId\.slice\(0,\s*8\)\.toUpperCase\(\)/);
  });

  test("requestPermanentDeletion imports the phrase formula rather than reimplementing it", () => {
    assert.match(source, /confirmationPhraseFor/);
    assert.match(source, /from "@\/lib\/trash"/);
  });

  test("getDeletionDependencyPreview only ever selects (counts) — never mutates anything while showing the preview", () => {
    const body = functionBody("getDeletionDependencyPreview");
    assert.doesNotMatch(body, /\.(insert|update|delete|upsert)\(/);
  });

  test("no Groq call anywhere — every trash operation is deterministic", () => {
    assert.doesNotMatch(stripComments(source), /groq/i);
  });
});

describe("20260926000000_trash.sql — narrowly-scoped, president-gated, no bulk deletion", () => {
  test("every mutating function re-checks is_president() itself, not just the caller's session cookie", () => {
    for (const fn of ["trash_suggestion", "restore_suggestion", "request_suggestion_deletion", "confirm_suggestion_deletion"]) {
      const start = migration.indexOf(`function public.${fn}(`);
      assert.notEqual(start, -1, `${fn} should be defined`);
      const end = migration.indexOf("$$;", start);
      const body = migration.slice(start, end);
      assert.match(body, /is_president\(\)/, `${fn} must re-check is_president()`);
    }
  });

  test("every function is SECURITY DEFINER with a pinned search_path", () => {
    for (const fn of [
      "list_trashed_suggestions",
      "trash_suggestion",
      "restore_suggestion",
      "request_suggestion_deletion",
      "confirm_suggestion_deletion",
      "count_my_removed_suggestions",
    ]) {
      const start = migration.indexOf(`function public.${fn}(`);
      assert.notEqual(start, -1, `${fn} should be defined`);
      const end = migration.indexOf("$$;", start);
      const body = migration.slice(start, end);
      assert.match(body, /security definer/i, `${fn} must be SECURITY DEFINER`);
      assert.match(body, /set search_path = public/, `${fn} must pin search_path`);
    }
  });

  test("execute is revoked from public and granted only to authenticated, for every trash function", () => {
    for (const fn of [
      "list_trashed_suggestions",
      "trash_suggestion",
      "restore_suggestion",
      "request_suggestion_deletion",
      "confirm_suggestion_deletion",
      "count_my_removed_suggestions",
    ]) {
      assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\(.*?\\) from public`));
      assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\(.*?\\) to authenticated`));
    }
  });

  test("no bulk permanent deletion — every mutating function takes exactly one suggestion id, never an array or a WHERE without an id filter", () => {
    assert.doesNotMatch(migration, /uuid\s*\[\]/);
    assert.doesNotMatch(migration, /delete from public\.suggestions\s*;/i);
  });

  test("the deletion audit table carries no student-identifying content — only category, actor, timestamps, and counts", () => {
    const start = migration.indexOf("create table if not exists public.suggestion_deletion_audit");
    const end = migration.indexOf(");", start);
    const body = migration.slice(start, end).toLowerCase();
    for (const forbidden of ["title", "description", "student_name", "student_email", "reason"]) {
      assert.doesNotMatch(body, new RegExp(forbidden));
    }
  });

  test("the deletion audit table has no client policies at all — presidents may only ever read it", () => {
    assert.match(migration, /revoke all on public\.suggestion_deletion_audit from anon, authenticated/);
    assert.doesNotMatch(migration, /grant insert on public\.suggestion_deletion_audit/);
  });

  test("the deletion-tokens table has no client policies at all — service/RPC only", () => {
    assert.match(migration, /revoke all on public\.suggestion_deletion_tokens from anon, authenticated/);
    assert.doesNotMatch(migration, /grant\s+\w+\s+on public\.suggestion_deletion_tokens\s+to (anon|authenticated)/);
  });

  test("a trashed suggestion is excluded from both the president read policy and the student's own read policy", () => {
    const presidentPolicy = migration.slice(
      migration.indexOf('create policy "presidents can read suggestions"'),
      migration.indexOf(";", migration.indexOf('create policy "presidents can read suggestions"')),
    );
    assert.match(presidentPolicy, /trashed_at is null/);

    const studentPolicy = migration.slice(
      migration.indexOf('create policy "students can read own suggestions"'),
      migration.indexOf(";", migration.indexOf('create policy "students can read own suggestions"')),
    );
    assert.match(studentPolicy, /trashed_at is null/);
  });

  test("count_my_removed_suggestions returns only a count — no title, reason, or actor column", () => {
    const start = migration.indexOf("function public.count_my_removed_suggestions()");
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    assert.match(body, /select count\(\*\)/i);
    assert.doesNotMatch(body.toLowerCase(), /title|trash_reason|trashed_by/);
  });

  test("request_suggestion_deletion requires the suggestion to already be trashed", () => {
    const start = migration.indexOf("function public.request_suggestion_deletion(");
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    assert.match(body, /trashed_at is not null/);
  });

  test("confirm_suggestion_deletion checks token existence, used_at, and expires_at before deleting anything", () => {
    const start = migration.indexOf("function public.confirm_suggestion_deletion(");
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    const foundIdx = body.indexOf("if not found");
    const usedIdx = body.indexOf("used_at is not null");
    const expiresIdx = body.indexOf("expires_at < now()");
    const deleteIdx = body.indexOf("delete from public.suggestions");
    assert.ok(foundIdx !== -1 && usedIdx !== -1 && expiresIdx !== -1 && deleteIdx !== -1);
    assert.ok(foundIdx < deleteIdx && usedIdx < deleteIdx && expiresIdx < deleteIdx);
  });
});
