-- ============================================================================
-- AI Co-President chat — conversations, messages, durable memory,
-- confirmation provenance
-- ============================================================================
-- Additive only. Nothing here touches, rewrites, or weakens any existing
-- table, policy, or grant from prior migrations. Reuses
-- public.is_president() (20260101000000) and public.enforce_workspace_
-- authorship() (20260922000000) rather than duplicating that logic.
--
-- Scope of this migration:
--   - chat_conversations        : one thread, shared by both co-presidents
--   - chat_messages              : the turns inside a thread (immutable)
--   - chat_pending_confirmations : one-time, expiring proposed mutations
--   - chat_memories              : durable facts a president has approved
--
-- ============================================================================
-- THE FORGERY PROBLEM THIS REVISION FIXES
-- ============================================================================
-- An earlier version of this migration let any authenticated president
-- INSERT any chat_messages row, including role = 'assistant' with an
-- arbitrary `structured` payload. That is a real hole: a browser (or any
-- direct request carrying the president's own valid session) could forge a
-- message that LOOKS like a genuine AI-generated confirmation card, and a
-- later "Confirm" click could be tricked into executing it. Immutability
-- after insertion proves nothing about who — or what code path — wrote the
-- row in the first place.
--
-- The fix has two parts:
--
-- 1. RLS now makes forgery of an assistant/confirmation message
--    IMPOSSIBLE for an authenticated client, not just discouraged:
--    the INSERT policy on chat_messages only ever allows
--    role = 'user' AND structured is null. There is no policy, at any
--    privilege level available to `authenticated`, that admits
--    role = 'assistant'. The only way an assistant row can exist is
--    through the service-role client, which bypasses RLS entirely and is
--    never exposed to the browser. Application code (Stage 2) must verify
--    getPresidentSession() itself before ever calling that path — the same
--    trust boundary this project already uses for the one other
--    service-role write (the student suggestion insert route only reaches
--    its own service-role step after its own checks). created_by on an
--    assistant row is filled in by the server from that verified session,
--    never from a client-supplied value — there is no client input to that
--    column at all on this path.
--
--    Because forging role = 'assistant' is now impossible for
--    `authenticated`, the mere existence of a chat_messages row with
--    role = 'assistant' IS proof it came from the trusted server path.
--    A Stage 2 confirmation handler should still check role = 'assistant'
--    explicitly (defense in depth costs nothing), but it no longer needs a
--    separate "trusted" flag to trust that check.
--
-- 2. A proposed mutation is no longer "just" the structured payload of an
--    immutable message. That was insufficient on its own: immutability
--    prevents rewriting a proposal, but proves nothing about one-time use,
--    expiry, or whether the record it targets has since changed — and an
--    immutable table has no field to atomically flip from "pending" to
--    "confirmed" without a second table. chat_pending_confirmations is
--    that minimal table: one row per proposal, created only by the same
--    trusted server path as the assistant message it belongs to, moved
--    from 'pending' to 'confirmed' by exactly one atomic, conditional
--    UPDATE in the Stage 2 confirm handler (`where status = 'pending' and
--    expires_at > now()`), which is what actually prevents replay and
--    stale/expired confirmation. `authenticated` gets read access only —
--    no insert, update, or delete grant at all — so a client can see a
--    confirmation's status but can never transition it.
--
-- Durable memory gets the analogous treatment for requirement 7 ("a direct
-- REST request must not silently create a durable AI memory outside the
-- confirmed flow"): chat_memories keeps direct, is_president()-gated CRUD,
-- because the product intentionally lets a president type a memory
-- directly into the Memory Manager — that is already a deliberate,
-- confirmed action, not something the AI did unilaterally. What changes is
-- that an AI-*proposed* memory ("Remember this?") is never written to
-- chat_memories directly by the AI or by inserting a row that merely
-- claims to be approved: it goes through the same chat_pending_
-- confirmations flow (action_type = 'save_memory') as every other
-- proposal, and only a president's own Confirm click — which runs as that
-- president, under normal is_president() RLS — ever performs the actual
-- INSERT into chat_memories. Nothing in this schema lets a row be
-- inserted while claiming AI provenance it doesn't have.
--
-- ============================================================================
-- What this migration does NOT add, and why
-- ============================================================================
--   - No audio column, anywhere.
--   - No API-key column, anywhere.
--   - No student-identity column, anywhere. chat_messages.structured and
--     chat_pending_confirmations.payload may hold S### references and
--     application-generated report data; they must never hold a student
--     name, email, or submitter id (enforced in the application layer that
--     builds this JSON, the same way suggestion text is already anonymized
--     before it reaches Groq).
--   - No citation join table for chat messages. A citation appearing
--     inside a chat message is validated against a fresh, RLS-scoped
--     suggestion lookup by the server at the moment the message is
--     written — the same allowlist pattern already used for meeting
--     briefs — and stored for display in `structured`. Contrast with
--     meeting_brief/decision/action citations, which back real, editable,
--     re-openable records and so earned real join tables in earlier
--     migrations.
--
-- ============================================================================
-- Deletion behavior (documented explicitly, per product requirement)
-- ============================================================================
--   - Deleting a conversation (chat_conversations) cascades to its own
--     chat_messages rows, and from there to any chat_pending_confirmations
--     row for those messages. It never touches meeting_briefs, meeting_
--     decisions, meeting_actions, suggestions, any citation table, or
--     chat_memories — none of those tables have any foreign key pointing
--     at chat_conversations, chat_messages, or chat_pending_confirmations,
--     so there is nothing for the cascade to reach.
--   - A durable memory is deleted only by its own explicit delete action
--     on chat_memories — never as a side effect of deleting a conversation
--     or a pending confirmation.
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
--
-- SECURITY: role = 'assistant' can only ever be written by the service-role
-- client (see the RLS policy below and the header note above). Do not add
-- an UPDATE policy, and do not relax the INSERT policy's role/structured
-- check, without re-reading that header note in full.
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
-- to those columns unconditionally. Runs for BOTH the authenticated-client
-- path (a 'user' message) and the service-role path (an 'assistant'
-- message) — auth.jwt() reflects whichever session the server attached to
-- the request, and Stage 2's service-role assistant-insert call must be
-- made using the verified president's own request context so this still
-- records the true acting president rather than an empty string.
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
-- 3. Pending confirmations
-- ---------------------------------------------------------------------------
-- One row per proposed mutation the assistant has surfaced as a
-- confirmation card. Created only by the trusted server path (same
-- privilege boundary as an assistant chat_messages row — see the header
-- note), in the same request that inserts that assistant message.
--
-- `action_type` is a closed, explicit list — nothing here lets the model
-- name an arbitrary table, column, or SQL statement. `payload` is the
-- exact, already-validated arguments the Stage 2 confirm handler will
-- re-validate again (record still exists, citations still resolve,
-- current state still matches) before calling the real server action.
create table if not exists public.chat_pending_confirmations (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null unique references public.chat_messages (id) on delete cascade,
  action_type  text not null check (action_type in (
    'save_meeting_brief',
    'update_meeting_brief',
    'archive_meeting_brief',
    'restore_meeting_brief',
    'create_decision',
    'update_decision',
    'delete_decision',
    'create_action',
    'update_action',
    'complete_action',
    'reopen_action',
    'delete_action',
    'save_meeting_cleanup',
    'save_memory',
    'delete_memory'
  )),
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'expired', 'invalidated')),
  expires_at   timestamptz not null,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  constraint chat_pending_confirmations_confirmed_fields_consistent
    check ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);

create index if not exists chat_pending_confirmations_status_idx
  on public.chat_pending_confirmations (status, expires_at);

-- Same insert-only authorship shape as chat_messages, for the same reason:
-- no updated_by/updated_at column pair for the shared trigger to write.
-- confirmed_by is set explicitly by the Stage 2 confirm handler's own
-- UPDATE (from that request's verified session), not by this trigger.
create or replace function public.enforce_pending_confirmation_authorship()
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

revoke all on function public.enforce_pending_confirmation_authorship() from public;

drop trigger if exists chat_pending_confirmations_authorship on public.chat_pending_confirmations;
create trigger chat_pending_confirmations_authorship
  before insert on public.chat_pending_confirmations
  for each row execute function public.enforce_pending_confirmation_authorship();

-- ---------------------------------------------------------------------------
-- 4. Durable memory
-- ---------------------------------------------------------------------------
-- Direct, is_president()-gated CRUD — this is what the Memory Manager uses
-- for a president's own deliberate add/edit/delete. An AI-*proposed*
-- memory never lands here directly; it goes through chat_pending_
-- confirmations (action_type = 'save_memory') like any other proposal, and
-- only a president's own Confirm click inserts the row (see header note).
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
alter table public.chat_conversations        enable row level security;
alter table public.chat_messages              enable row level security;
alter table public.chat_pending_confirmations enable row level security;
alter table public.chat_memories              enable row level security;

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

-- THE FIX: an authenticated client may only ever insert a plain user
-- message. role = 'assistant', or any row carrying a structured payload,
-- is rejected by RLS regardless of what the client sends — there is no
-- authenticated-accessible path to either. Only the service-role client
-- (never exposed to the browser, used solely by trusted Stage 2 server
-- code after it has independently verified getPresidentSession()) can
-- insert an assistant/structured row, because service-role bypasses RLS.
drop policy if exists "presidents can insert messages" on public.chat_messages;
drop policy if exists "presidents can insert their own user messages" on public.chat_messages;
create policy "presidents can insert their own user messages"
  on public.chat_messages for insert
  to authenticated
  with check (
    public.is_president()
    and role = 'user'
    and structured is null
  );

drop policy if exists "presidents can delete messages" on public.chat_messages;
create policy "presidents can delete messages"
  on public.chat_messages for delete
  to authenticated
  using (public.is_president());

-- No update policy on chat_messages: messages are immutable by design.

-- chat_pending_confirmations: read-only for authenticated (so the UI can
-- show status/expiry), never writable. Only status transitions performed
-- by the service-role client (Stage 2's confirm handler, itself gated on
-- getPresidentSession()) can move a proposal from pending to confirmed/
-- expired/invalidated, or create one in the first place.
drop policy if exists "presidents can read pending confirmations" on public.chat_pending_confirmations;
create policy "presidents can read pending confirmations"
  on public.chat_pending_confirmations for select
  to authenticated
  using (public.is_president());

-- Deliberately no insert/update/delete policy for `authenticated` on
-- chat_pending_confirmations, matching the absence of any such grant below.

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
-- are even offered. anon gets nothing at all on any of the four tables.
revoke all on public.chat_conversations        from anon, authenticated;
revoke all on public.chat_messages              from anon, authenticated;
revoke all on public.chat_pending_confirmations from anon, authenticated;
revoke all on public.chat_memories              from anon, authenticated;

grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert, delete         on public.chat_messages      to authenticated;
-- chat_pending_confirmations: select only — no insert/update/delete grant
-- at all for authenticated. Every write goes through service-role.
grant select                         on public.chat_pending_confirmations to authenticated;
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
    begin
      alter publication supabase_realtime add table public.chat_pending_confirmations;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;
