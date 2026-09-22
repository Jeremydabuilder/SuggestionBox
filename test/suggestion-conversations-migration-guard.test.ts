import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

const migration = read("supabase/migrations/20260927000000_suggestion_conversations.sql");

function functionBody(name: string, argSig: string): string {
  const start = migration.indexOf(`function public.${name}(${argSig})`);
  assert.notEqual(start, -1, `${name}(${argSig}) should be defined`);
  const end = migration.indexOf("$$;", start);
  return migration.slice(start, end);
}

describe("20260927000000_suggestion_conversations.sql — table grants", () => {
  test("suggestion_messages has NO grant to authenticated at all — every read and write goes through a function", () => {
    assert.match(migration, /revoke all on public\.suggestion_messages\s+from anon, authenticated;/);
    assert.doesNotMatch(migration, /grant\s+\w+.*on public\.suggestion_messages\s+to (anon|authenticated)/);
  });

  test("suggestion_conversations grants SELECT only — no insert/update/delete grant or policy for a client", () => {
    assert.match(migration, /grant select on public\.suggestion_conversations to authenticated;/);
    assert.doesNotMatch(migration, /grant\s+(insert|update|delete|all)\s+on public\.suggestion_conversations/i);
    assert.doesNotMatch(migration, /for (insert|update|delete)\s*\n\s*to authenticated\s*\n\s*(using|with check)[\s\S]{0,80}suggestion_conversations/i);
  });

  test("no anon grant anywhere in this file", () => {
    assert.doesNotMatch(migration, /grant\s+\w+.*to anon\b/);
  });
});

describe("20260927000000_suggestion_conversations.sql — RLS policies", () => {
  test("the conversations SELECT policy admits a president unconditionally and a student only via their own submitter_user_id", () => {
    const start = migration.indexOf('create policy "presidents and the owning student can read conversation state"');
    const end = migration.indexOf(";", start);
    const policy = migration.slice(start, end);
    assert.match(policy, /public\.is_president\(\)/);
    assert.match(policy, /s\.submitter_user_id = auth\.uid\(\)/);
  });
});

describe("20260927000000_suggestion_conversations.sql — read functions never leak identity to a student", () => {
  test("list_my_conversation_messages returns only id/sender_role/body/created_at — no sender_email, no sender_user_id", () => {
    const start = migration.indexOf("function public.list_my_conversation_messages(p_suggestion_id uuid)");
    const returnsBlock = migration.slice(start, migration.indexOf("as $$", start));
    assert.doesNotMatch(returnsBlock, /sender_email/);
    assert.doesNotMatch(returnsBlock, /sender_user_id/);
    assert.match(returnsBlock, /sender_role/);
    assert.match(returnsBlock, /body/);
  });

  test("list_my_conversation_messages checks submitter_user_id = auth.uid() AND trashed_at is null explicitly in its own body (not relying on RLS inside a SECURITY DEFINER function)", () => {
    const body = functionBody("list_my_conversation_messages", "p_suggestion_id uuid");
    assert.match(body, /s\.submitter_user_id = auth\.uid\(\)/);
    assert.match(body, /s\.trashed_at is null/);
  });

  test("list_president_conversation_messages requires is_president() and DOES return sender_email (internal audit, president-only)", () => {
    const start = migration.indexOf("function public.list_president_conversation_messages(p_suggestion_id uuid)");
    const returnsBlock = migration.slice(start, migration.indexOf("as $$", start));
    assert.match(returnsBlock, /sender_email/);
    const body = functionBody("list_president_conversation_messages", "p_suggestion_id uuid");
    assert.match(body, /public\.is_president\(\)/);
  });

  test("every read/write function is SECURITY DEFINER with a pinned search_path and execute revoked from public", () => {
    for (const [name, sig] of [
      ["list_my_conversation_messages", "uuid"],
      ["list_president_conversation_messages", "uuid"],
      ["count_conversation_messages", "uuid"],
      ["send_suggestion_message", "uuid, text"],
      ["resolve_suggestion_conversation", "uuid"],
      ["reopen_suggestion_conversation", "uuid"],
      ["mark_conversation_read_by_student", "uuid"],
      ["mark_conversation_read_by_president", "uuid"],
    ]) {
      const start = migration.indexOf(`function public.${name}(`);
      assert.notEqual(start, -1, `${name} should be defined`);
      const end = migration.indexOf("$$;", start);
      const block = migration.slice(start, end);
      assert.match(block, /security definer/i, `${name} must be SECURITY DEFINER`);
      assert.match(block, /set search_path = public/, `${name} must pin search_path`);
      assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\(${sig}\\) from public`));
      assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\(${sig}\\) to authenticated`));
    }
  });
});

describe("20260927000000_suggestion_conversations.sql — write function invariants", () => {
  test("send_suggestion_message determines sender_role from verified identity, never from a client argument", () => {
    const body = functionBody("send_suggestion_message", "p_suggestion_id uuid, p_body text");
    // The function signature itself takes no role/sender parameter at all.
    assert.doesNotMatch(migration.slice(migration.indexOf("function public.send_suggestion_message("), migration.indexOf("as $$", migration.indexOf("function public.send_suggestion_message("))), /p_role|p_sender/);
    assert.match(body, /v_is_president\s+boolean := public\.is_president\(\)/);
    assert.match(body, /submitter_user_id = v_uid/);
  });

  test("send_suggestion_message blocks writing to a trashed suggestion's conversation for both roles, before any role branching", () => {
    const body = functionBody("send_suggestion_message", "p_suggestion_id uuid, p_body text");
    const trashedCheckIdx = body.indexOf("v_trashed_at is not null");
    const roleBranchIdx = body.indexOf("if v_is_president then");
    assert.notEqual(trashedCheckIdx, -1);
    assert.notEqual(roleBranchIdx, -1);
    assert.ok(trashedCheckIdx < roleBranchIdx, "the trashed check must happen before role-specific logic");
  });

  test("a student reply to a resolved conversation auto-reopens it", () => {
    const body = functionBody("send_suggestion_message", "p_suggestion_id uuid, p_body text");
    assert.match(body, /v_role = 'student' and v_conversation\.state = 'resolved'/);
    assert.match(body, /state = 'open', reopened_at = now\(\)/);
  });

  test("message length is validated (1-2000 chars) before any database write", () => {
    const body = functionBody("send_suggestion_message", "p_suggestion_id uuid, p_body text");
    const lengthCheckIdx = body.indexOf("char_length(v_body)");
    const insertIdx = body.indexOf("insert into public.suggestion_messages");
    assert.notEqual(lengthCheckIdx, -1);
    assert.ok(lengthCheckIdx < insertIdx);
  });

  test("resolve/reopen require is_president() and stamp the calling president's own verified email, never an argument", () => {
    for (const name of ["resolve_suggestion_conversation", "reopen_suggestion_conversation"]) {
      const body = functionBody(name, "p_suggestion_id uuid");
      assert.match(body, /public\.is_president\(\)/);
      assert.match(body, /lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)/);
    }
  });

  test("mark_conversation_read_by_president updates only the calling president's own key in the jsonb map (jsonb_set keyed by their own email)", () => {
    const body = functionBody("mark_conversation_read_by_president", "p_suggestion_id uuid");
    assert.match(body, /jsonb_set\(president_reads, array\[v_email\], to_jsonb\(now\(\)::text\), true\)/);
  });

  test("mark_conversation_read_by_student requires submitter_user_id = auth.uid() and trashed_at is null", () => {
    const body = functionBody("mark_conversation_read_by_student", "p_suggestion_id uuid");
    assert.match(body, /submitter_user_id = auth\.uid\(\)/);
    assert.match(body, /trashed_at is null/);
  });
});

describe("20260927000000_suggestion_conversations.sql — immutability and no bulk anything", () => {
  test("no UPDATE or DELETE is ever issued against suggestion_messages anywhere in this file — messages are write-once", () => {
    assert.doesNotMatch(migration, /update public\.suggestion_messages/i);
    assert.doesNotMatch(migration, /delete from public\.suggestion_messages/i);
  });

  test("every function takes exactly one suggestion id — no array parameter, no bulk operation", () => {
    assert.doesNotMatch(migration, /uuid\s*\[\]/);
  });
});

describe("20260927000000_suggestion_conversations.sql — realtime", () => {
  test("only suggestion_conversations is added to the realtime publication — suggestion_messages never is", () => {
    assert.match(migration, /alter publication supabase_realtime add table public\.suggestion_conversations;/);
    assert.doesNotMatch(migration, /alter publication supabase_realtime add table public\.suggestion_messages;/);
  });
});

describe("20260927000000_suggestion_conversations.sql — Trash cascade extension", () => {
  test("the deletion audit table gains a message count column, additively", () => {
    assert.match(migration, /alter table public\.suggestion_deletion_audit\s+add column if not exists dependent_message_count integer not null default 0;/);
  });

  test("confirm_suggestion_deletion counts suggestion_messages before the delete and stores it in the audit row", () => {
    const start = migration.lastIndexOf("function public.confirm_suggestion_deletion(p_token text)");
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    const countIdx = body.indexOf("v_message_count from public.suggestion_messages");
    const insertIdx = body.indexOf("insert into public.suggestion_deletion_audit");
    const deleteIdx = body.indexOf("delete from public.suggestions");
    assert.notEqual(countIdx, -1);
    assert.ok(countIdx < insertIdx && insertIdx < deleteIdx);
    assert.match(body, /dependent_message_count/);
  });

  test("count_conversation_messages is president-gated and returns 0 rather than raising for anyone else", () => {
    const body = functionBody("count_conversation_messages", "p_suggestion_id uuid");
    assert.match(body, /public\.is_president\(\)/);
    assert.match(body, /else 0/);
  });
});
