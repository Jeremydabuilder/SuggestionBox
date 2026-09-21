-- ============================================================================
-- AI Co-President chat — conversations, messages, durable memory
-- ============================================================================
-- Additive only. Nothing here touches, rewrites, or weakens any existing
-- table, policy, or grant from prior migrations. Reuses
-- public.is_president() (20260101000000) and public.enforce_workspace_
-- authorship() (20260922000000) rather than duplicating that logic.
--
-- Scope of this migration, deliberately minimal:
--   - chat_conversations : one thread, shared by both co-presidents
--   - chat_messages      : the turns inside a thread (immutable once written)
--   - chat_memories      : durable facts a president has explicitly approved
--
-- What this migration does NOT add, and why:
--   - No "pending confirmation" table. A proposed mutation (save a brief,
--     create a decision, etc.) is stored as the structured payload of the
--     assistant's own chat_messages row — which is already immutable and
--     already RLS-protected. Confirming an action re-reads that same row,
--     re-validates everything against the live database, and calls the
--     real, existing server action (saveMeetingBrief, createDecision, ...).
--     A separate mutable table would only duplicate that payload and add a
--     second place for it to drift out of sync with the message it came
--     from, without adding any real safety.
--   - No audio column, anywhere.
--   - No API-key column, anywhere.
--   - No student-identity column, anywhere. chat_messages.structured may
--     hold S### references and application-generated report data; it must
--     never hold a student name, email, or submitter id (enforced in the
--     application layer that builds this JSON, the same way suggestion
--     text is already anonymized before it reaches Groq).
--   - No citation join table. A citation appearing inside a chat message is
--     a display concern (which suggestion this sentence is about), not a
--     relationship the database needs to enforce with a foreign key — it is
--     validated against a fresh, RLS-scoped suggestion lookup by the server
--     at the moment the message is written, the same allowlist pattern
--     already used for meeting briefs. Contrast with meeting_brief/decision/
--     action citations, which back real, editable, re-openable records and
--     so earned real join tables in earlier migrations.
--
-- Deletion behavior (documented explicitly, per product requirement):
--   - Deleting a conversation (chat_conversations) cascades ONLY to its own
--     chat_messages rows. It never touches meeting_briefs, meeting_
--     decisions, meeting_actions, suggestions, any citation table, or
--     chat_memories — none of those tables have any foreign key pointing
--     at chat_conversations or chat_messages, so there is nothing for the
--     cascade to reach. A durable memory is deleted only by its own
--     explicit delete action on chat_memories.
--
-- Run this in the Supabase SQL editor, or with `supabase db push`. It is
-- idempotent enough to re-run safely.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'chat_message_role') then
    create type public.chat_message_role as enum ('user', 'assistant');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Conversations
-- ---------------------------------------------------------------------------
-- One shared workspace: either co-president may read, rename, or delete any
-- conversation, the same shared-access shape as meeting_briefs/meeting_
-- decisions/meeting_actions. created_by records who started it; that is an
-- audit fact, not an access boundary.
create table if not exists public.chat_conversations (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default 'New conversation' check (char_length(title) between 1 and 200),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_by  text not null,
  updated_at  timestamptz not null default now()
);

create index if not exists chat_conversations_updated_at_idx
  on public.chat_conversations (updated_at desc);

drop trigger if exists chat_conversations_authorship on public.chat_conversations;
create trigger chat_conversations_authorship
  before insert or update on public.chat_conversations
  for each row execute function public.enforce_workspace_authorship();

-- ---------------------------------------------------------------------------
-- 2. Messages
-- ---------------------------------------------------------------------------
-- Immutable once written — no updated_at/updated_by, and no update policy
-- below. A wrong message is deleted (which the UI never exposes per-message,
-- only per-conversation) and re-sent, never silently rewritten.
--
-- `structured` carries whatever the UI needs to render the message as more
-- than prose: a confirmation card's exact proposed payload, a deterministic
-- report, a list of S### citations, an error/rate-limit state. It is written
-- and read only by server code; never treat its contents as instructions.
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  role            public.chat_message_role not null,
  content         text not null check (char_length(content) between 1 and 8000),
  structured      jsonb,
  created_by      text not null,
  created_at      timestamptz not null default now()
);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at asc);

-- Insert-only authorship: chat_messages has no updated_by/updated_at to set,
-- so it gets its own small trigger rather than the shared one, which writes
-- to those columns unconditionally.
create or replace function public.enforce_chat_message_authorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.created_at := coalesce(new.created_at, now());
  return new;
end;
$$;

revoke all on function public.enforce_chat_message_authorship() from public;

drop trigger if exists chat_messages_authorship on public.chat_messages;
create trigger chat_messages_authorship
  before insert on public.chat_messages
  for each row execute function public.enforce_chat_message_authorship();

-- A new message bumps its conversation's updated_at, so "recent
-- conversations" sorts by actual activity rather than only creation time.
create or replace function public.touch_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.touch_chat_conversation() from public;

drop trigger if exists chat_messages_touch_conversation on public.chat_messages;
create trigger chat_messages_touch_conversation
  after insert on public.chat_messages
  for each row execute function public.touch_chat_conversation();

-- ---------------------------------------------------------------------------
-- 3. Durable memory
-- ---------------------------------------------------------------------------
-- Only ever written by an explicit president confirmation (never by the
-- model directly, never silently). Free text by design — a stable
-- preference like a meeting day or a tone note, not a structured record.
-- Deliberately short: this is a handful of standing facts, not a log.
create table if not exists public.chat_memories (
  id           uuid primary key default gen_random_uuid(),
  memory_text  text not null check (char_length(memory_text) between 1 and 500),
  category     text check (category is null or category in ('meeting_format', 'terminology', 'tone', 'constraint', 'other')),
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_by   text not null,
  updated_at   timestamptz not null default now()
);

create index if not exists chat_memories_created_at_idx
  on public.chat_memories (created_at desc);

drop trigger if exists chat_memories_authorship on public.chat_memories;
create trigger chat_memories_authorship
  before insert or update on public.chat_memories
  for each row execute function public.enforce_workspace_authorship();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.chat_conversations enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.chat_memories      enable row level security;

drop policy if exists "presidents can read conversations" on public.chat_conversations;
create policy "presidents can read conversations"
  on public.chat_conversations for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert conversations" on public.chat_conversations;
create policy "presidents can insert conversations"
  on public.chat_conversations for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can update conversations" on public.chat_conversations;
create policy "presidents can update conversations"
  on public.chat_conversations for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

drop policy if exists "presidents can delete conversations" on public.chat_conversations;
create policy "presidents can delete conversations"
  on public.chat_conversations for delete
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can read messages" on public.chat_messages;
create policy "presidents can read messages"
  on public.chat_messages for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert messages" on public.chat_messages;
create policy "presidents can insert messages"
  on public.chat_messages for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can delete messages" on public.chat_messages;
create policy "presidents can delete messages"
  on public.chat_messages for delete
  to authenticated
  using (public.is_president());

-- No update policy on chat_messages: messages are immutable by design.

drop policy if exists "presidents can read memories" on public.chat_memories;
create policy "presidents can read memories"
  on public.chat_memories for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert memories" on public.chat_memories;
create policy "presidents can insert memories"
  on public.chat_memories for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can update memories" on public.chat_memories;
create policy "presidents can update memories"
  on public.chat_memories for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

drop policy if exists "presidents can delete memories" on public.chat_memories;
create policy "presidents can delete memories"
  on public.chat_memories for delete
  to authenticated
  using (public.is_president());

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
-- RLS decides which ROWS are visible; these GRANTs decide which OPERATIONS
-- are even offered. anon gets nothing at all on any of the three tables.
revoke all on public.chat_conversations from anon, authenticated;
revoke all on public.chat_messages      from anon, authenticated;
revoke all on public.chat_memories      from anon, authenticated;

grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert, delete         on public.chat_messages      to authenticated;
grant select, insert, update, delete on public.chat_memories      to authenticated;

-- No grants to anon on any table in this migration.

-- ---------------------------------------------------------------------------
-- Realtime: both co-presidents see new messages/conversations live, same as
-- the existing workspace tables.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.chat_conversations;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.chat_messages;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;
