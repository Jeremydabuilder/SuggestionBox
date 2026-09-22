-- ============================================================================
-- Suggestion Conversations
-- ============================================================================
-- One private, in-app conversation per suggestion, between its (verified,
-- signed-in) student submitter and the co-presidents. Not a public chat
-- room and not general direct messaging: every conversation and every
-- message belongs to exactly one suggestion, and there is no path anywhere
-- in this file for a student to message another student or read another
-- student's thread.
--
-- Every read a student can make and every write anyone can make goes
-- through a narrowly-scoped SECURITY DEFINER function, the same trust
-- pattern already used throughout this project (is_president(),
-- record_status_change(), the trash_* functions). suggestion_messages in
-- particular carries the sender's real, verified email for internal
-- audit — a column a student must never be able to read, for any
-- president message, under any circumstance — so raw table SELECT is
-- revoked entirely for suggestion_messages and replaced with two
-- role-appropriate read functions. Nothing here ever grants INSERT,
-- UPDATE, or DELETE on either table to a client: a message, once sent, is
-- physically impossible to edit or delete except by the existing
-- suggestion-cascade-delete path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Conversation state — one row per suggestion, created lazily on the
--    first message
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'conversation_state') then
    create type public.conversation_state as enum ('open', 'resolved');
  end if;
end
$$;

create table if not exists public.suggestion_conversations (
  id                       uuid primary key default gen_random_uuid(),
  suggestion_id            uuid not null unique references public.suggestions (id) on delete cascade,
  state                    public.conversation_state not null default 'open',
  resolved_at              timestamptz,
  resolved_by              text,
  reopened_at              timestamptz,
  reopened_by              text,
  last_student_message_at  timestamptz,
  last_president_message_at timestamptz,
  student_last_read_at     timestamptz,
  -- Per-president read state, keyed by lowercased email → ISO timestamp
  -- string. A jsonb map rather than a second table: with exactly two
  -- co-presidents this stays simple to read and simple to update
  -- atomically (a single jsonb_set inside a SECURITY DEFINER function —
  -- see mark_conversation_read_by_president below), while still giving
  -- each president their own independent "have I seen this" state, which
  -- a single shared timestamp column could not.
  president_reads         jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists suggestion_conversations_state_idx on public.suggestion_conversations (state);

drop trigger if exists suggestion_conversations_touch_updated_at on public.suggestion_conversations;
create trigger suggestion_conversations_touch_updated_at
  before update on public.suggestion_conversations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Messages — immutable once written
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'conversation_sender_role') then
    create type public.conversation_sender_role as enum ('student', 'president');
  end if;
end
$$;

create table if not exists public.suggestion_messages (
  id              uuid primary key default gen_random_uuid(),
  -- Direct FK to suggestions (not just to the conversation) so every RLS
  -- policy and every dependency count below can filter on suggestion_id
  -- with no join through suggestion_conversations required.
  suggestion_id   uuid not null references public.suggestions (id) on delete cascade,
  conversation_id uuid not null references public.suggestion_conversations (id) on delete cascade,
  sender_role     public.conversation_sender_role not null,
  -- Verified identity, for internal audit only. A student must NEVER be
  -- able to read sender_email/sender_user_id for a president-authored
  -- message — see list_my_conversation_messages() below, the only read
  -- path a student has, which omits both columns entirely.
  sender_user_id  uuid,
  sender_email    text not null,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);

create index if not exists suggestion_messages_suggestion_idx on public.suggestion_messages (suggestion_id, created_at asc);
create index if not exists suggestion_messages_conversation_idx on public.suggestion_messages (conversation_id, created_at asc);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.suggestion_conversations enable row level security;
alter table public.suggestion_messages       enable row level security;

-- suggestion_conversations carries no identity-sensitive column (no
-- email, no user id), so a plain RLS-scoped SELECT is safe: a president
-- always qualifies; a student qualifies only through the same
-- submitter_user_id = auth.uid() relationship "students can read own
-- suggestions" already uses, and — because that subquery runs under the
-- querying role's own RLS on suggestions — a trashed suggestion (whose
-- own student-read policy already requires trashed_at is null) makes its
-- conversation invisible to the student too, automatically, with no
-- extra condition needed here.
drop policy if exists "presidents and the owning student can read conversation state" on public.suggestion_conversations;
create policy "presidents and the owning student can read conversation state"
  on public.suggestion_conversations for select
  to authenticated
  using (
    public.is_president()
    or exists (
      select 1 from public.suggestions s
      where s.id = suggestion_conversations.suggestion_id
        and s.submitter_user_id = auth.uid()
    )
  );

-- No insert/update/delete policy at all: state changes (create on first
-- message, resolve, reopen, mark-read) only ever happen inside the
-- SECURITY DEFINER functions below, which bypass RLS as the owning role —
-- exactly like the trash_suggestion()/restore_suggestion() pattern.

-- suggestion_messages has NO client-facing policy or grant of any kind.
-- Every read and every write goes through a function. This is the only
-- way to guarantee — at the database level, not just by app-code
-- discipline — that a student can never see sender_email for a
-- president's message, no matter what query a technically sophisticated
-- student's own browser session could otherwise construct against the
-- REST API with the same session cookie.

revoke all on public.suggestion_conversations from anon, authenticated;
revoke all on public.suggestion_messages       from anon, authenticated;
grant select on public.suggestion_conversations to authenticated;
-- No grant at all on suggestion_messages for authenticated — see above.

-- ---------------------------------------------------------------------------
-- 4. list_my_conversation_messages() — the ONLY way a student reads
--    messages. Deliberately excludes sender_email and sender_user_id.
-- ---------------------------------------------------------------------------
create or replace function public.list_my_conversation_messages(p_suggestion_id uuid)
returns table (
  id          uuid,
  sender_role public.conversation_sender_role,
  body        text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  -- trashed_at is null is spelled out explicitly here, not left to RLS:
  -- a SECURITY DEFINER function body runs with the function owner's
  -- privilege and does not itself apply the caller's RLS policies to a
  -- query inside it (unlike an RLS policy's own USING clause, which does
  -- run as the querying role) — so without this, a trashed suggestion's
  -- conversation would stay readable to its student here even though
  -- every ordinary read already hides it.
  select m.id, m.sender_role, m.body, m.created_at
  from public.suggestion_messages m
  where m.suggestion_id = p_suggestion_id
    and exists (
      select 1 from public.suggestions s
      where s.id = p_suggestion_id
        and s.submitter_user_id = auth.uid()
        and s.trashed_at is null
    )
  order by m.created_at asc
  limit 500;
$$;

revoke all on function public.list_my_conversation_messages(uuid) from public;
grant execute on function public.list_my_conversation_messages(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. list_president_conversation_messages() — full columns, president only
-- ---------------------------------------------------------------------------
create or replace function public.list_president_conversation_messages(p_suggestion_id uuid)
returns table (
  id           uuid,
  sender_role  public.conversation_sender_role,
  sender_email text,
  body         text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.sender_role, m.sender_email, m.body, m.created_at
  from public.suggestion_messages m
  where m.suggestion_id = p_suggestion_id
    and public.is_president()
  order by m.created_at asc
  limit 500;
$$;

revoke all on function public.list_president_conversation_messages(uuid) from public;
grant execute on function public.list_president_conversation_messages(uuid) to authenticated;

-- Exact message count for the Trash permanent-deletion dependency
-- preview — a plain SELECT count on suggestion_messages isn't otherwise
-- reachable at all (see section 2's doc comment), and the read functions
-- above are capped at 500 rows, which would undercount a longer thread.
create or replace function public.count_conversation_messages(p_suggestion_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_president()
    then (select count(*)::integer from public.suggestion_messages where suggestion_id = p_suggestion_id)
    else 0
  end;
$$;

revoke all on function public.count_conversation_messages(uuid) from public;
grant execute on function public.count_conversation_messages(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. send_suggestion_message() — the only way any message is created
-- ---------------------------------------------------------------------------
-- Determines the sender's role itself from verified identity (is_president()
-- for a co-president; submitter_user_id = auth.uid() for the owning
-- student) — never from a client-supplied role argument, so neither side
-- can forge the other's identity. Blocks writing to a trashed
-- suggestion's conversation entirely (read-only while trashed). A
-- student's reply to an already-resolved conversation automatically
-- reopens it — chosen over silently leaving it resolved, since a resolved
-- thread a president isn't actively watching is the likelier place for a
-- new student message to go unnoticed; auto-reopening surfaces it the
-- same way any other new message would.
create or replace function public.send_suggestion_message(p_suggestion_id uuid, p_body text)
returns public.suggestion_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email          text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_uid            uuid := auth.uid();
  v_is_president   boolean := public.is_president();
  v_role           public.conversation_sender_role;
  v_body           text := trim(coalesce(p_body, ''));
  v_trashed_at     timestamptz;
  v_conversation   public.suggestion_conversations%rowtype;
  v_message        public.suggestion_messages%rowtype;
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'A message must be between 1 and 2000 characters.';
  end if;

  select trashed_at into v_trashed_at from public.suggestions where id = p_suggestion_id;
  if not found then
    raise exception 'That suggestion could not be found.';
  end if;
  if v_trashed_at is not null then
    raise exception 'This suggestion is in Trash — its conversation is read-only.';
  end if;

  if v_is_president then
    v_role := 'president';
  else
    if not exists (
      select 1 from public.suggestions
      where id = p_suggestion_id and submitter_user_id = v_uid
    ) then
      raise exception 'Not authorized.';
    end if;
    v_role := 'student';
  end if;

  select * into v_conversation from public.suggestion_conversations where suggestion_id = p_suggestion_id;
  if not found then
    insert into public.suggestion_conversations (suggestion_id)
    values (p_suggestion_id)
    returning * into v_conversation;
  end if;

  if v_role = 'student' and v_conversation.state = 'resolved' then
    update public.suggestion_conversations
    set state = 'open', reopened_at = now(), reopened_by = null
    where id = v_conversation.id
    returning * into v_conversation;
  end if;

  insert into public.suggestion_messages (suggestion_id, conversation_id, sender_role, sender_user_id, sender_email, body)
  values (p_suggestion_id, v_conversation.id, v_role, v_uid, v_email, v_body)
  returning * into v_message;

  if v_role = 'student' then
    update public.suggestion_conversations set last_student_message_at = v_message.created_at where id = v_conversation.id;
  else
    update public.suggestion_conversations set last_president_message_at = v_message.created_at where id = v_conversation.id;
  end if;

  return v_message;
end;
$$;

revoke all on function public.send_suggestion_message(uuid, text) from public;
grant execute on function public.send_suggestion_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. resolve / reopen — president only
-- ---------------------------------------------------------------------------
create or replace function public.resolve_suggestion_conversation(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized.';
  end if;

  update public.suggestion_conversations
  set state = 'resolved', resolved_at = now(), resolved_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where suggestion_id = p_suggestion_id;

  if not found then
    raise exception 'There is no conversation for that suggestion yet.';
  end if;
end;
$$;

revoke all on function public.resolve_suggestion_conversation(uuid) from public;
grant execute on function public.resolve_suggestion_conversation(uuid) to authenticated;

create or replace function public.reopen_suggestion_conversation(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized.';
  end if;

  update public.suggestion_conversations
  set state = 'open', reopened_at = now(), reopened_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where suggestion_id = p_suggestion_id;

  if not found then
    raise exception 'There is no conversation for that suggestion yet.';
  end if;
end;
$$;

revoke all on function public.reopen_suggestion_conversation(uuid) from public;
grant execute on function public.reopen_suggestion_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Read receipts
-- ---------------------------------------------------------------------------
create or replace function public.mark_conversation_read_by_student(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.suggestions
    where id = p_suggestion_id and submitter_user_id = auth.uid() and trashed_at is null
  ) then
    raise exception 'Not authorized.';
  end if;

  update public.suggestion_conversations
  set student_last_read_at = now()
  where suggestion_id = p_suggestion_id;
  -- No conversation row yet means no messages, so nothing to mark read —
  -- a no-op here is correct, not an error.
end;
$$;

revoke all on function public.mark_conversation_read_by_student(uuid) from public;
grant execute on function public.mark_conversation_read_by_student(uuid) to authenticated;

create or replace function public.mark_conversation_read_by_president(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_president() then
    raise exception 'Not authorized.';
  end if;

  update public.suggestion_conversations
  set president_reads = jsonb_set(president_reads, array[v_email], to_jsonb(now()::text), true)
  where suggestion_id = p_suggestion_id;
end;
$$;

revoke all on function public.mark_conversation_read_by_president(uuid) from public;
grant execute on function public.mark_conversation_read_by_president(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Realtime — suggestion_conversations only, deliberately
-- ---------------------------------------------------------------------------
-- Supabase Realtime's postgres_changes delivery is a row-level RLS check,
-- not a column-level one — a client subscribed to a table's changes
-- receives the row's full column set once RLS says the row is visible to
-- them, the same way a raw SELECT would. suggestion_messages has no
-- SELECT grant or policy at all specifically so sender_email can never
-- reach a student for a president's message (section 5's whole reason for
-- existing) — putting it on realtime would reopen exactly that leak the
-- moment a permissive-enough policy was ever added for delivery to work.
--
-- suggestion_conversations carries no identity-sensitive column, so it is
-- realtime-safe on its own, and its last_student_message_at /
-- last_president_message_at / updated_at fields already change on every
-- new message and every resolve/reopen. The client-side pattern is: watch
-- suggestion_conversations for the current suggestion_id, and on any
-- change, re-fetch messages through the appropriate safe function
-- (list_my_conversation_messages / list_president_conversation_messages)
-- — never trust a realtime payload as the message content itself.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.suggestion_conversations;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Extend the Trash permanent-deletion audit and cascade for messages
-- ---------------------------------------------------------------------------
-- Additive only, on the existing (already-applied) trash migration's own
-- table and function — never edit an applied migration file itself.
-- suggestion_messages already cascades on suggestion delete via its own
-- FK (section 2 above), so no change to the delete itself is needed; only
-- the audit record and its dependency counting gain a message count.
alter table public.suggestion_deletion_audit
  add column if not exists dependent_message_count integer not null default 0;

create or replace function public.confirm_suggestion_deletion(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_row      public.suggestion_deletion_tokens%rowtype;
  v_category       public.suggestion_category;
  v_notes_count    integer;
  v_history_count  integer;
  v_match_count    integer;
  v_citation_count integer;
  v_message_count  integer;
begin
  if not public.is_president() then
    raise exception 'Not authorized.';
  end if;

  select * into v_token_row
  from public.suggestion_deletion_tokens
  where token = p_token
  for update;

  if not found then
    raise exception 'This confirmation is invalid. Request a new one.';
  end if;
  if v_token_row.used_at is not null then
    raise exception 'This confirmation has already been used.';
  end if;
  if v_token_row.expires_at < now() then
    raise exception 'This confirmation has expired. Request a new one.';
  end if;

  select category into v_category
  from public.suggestions
  where id = v_token_row.suggestion_id and trashed_at is not null;

  if not found then
    raise exception 'That suggestion is no longer in Trash, so this confirmation no longer applies.';
  end if;

  update public.suggestion_deletion_tokens
  set used_at = now()
  where id = v_token_row.id;

  select count(*) into v_notes_count from public.internal_notes where suggestion_id = v_token_row.suggestion_id;
  select count(*) into v_history_count from public.status_history where suggestion_id = v_token_row.suggestion_id;
  select count(*) into v_match_count from public.suggestion_matches
    where suggestion_id = v_token_row.suggestion_id or match_id = v_token_row.suggestion_id;
  select count(*) into v_citation_count from (
    select suggestion_id from public.meeting_brief_citations where suggestion_id = v_token_row.suggestion_id
    union all
    select suggestion_id from public.meeting_decision_citations where suggestion_id = v_token_row.suggestion_id
    union all
    select suggestion_id from public.meeting_action_citations where suggestion_id = v_token_row.suggestion_id
  ) c;
  select count(*) into v_message_count from public.suggestion_messages where suggestion_id = v_token_row.suggestion_id;

  insert into public.suggestion_deletion_audit (
    deleted_suggestion_id, suggestion_category, performed_by,
    dependent_notes_count, dependent_history_count, dependent_match_count, dependent_citation_count,
    dependent_message_count
  ) values (
    v_token_row.suggestion_id, v_category, lower(coalesce(auth.jwt() ->> 'email', '')),
    v_notes_count, v_history_count, v_match_count, v_citation_count,
    v_message_count
  );

  delete from public.suggestions where id = v_token_row.suggestion_id;
end;
$$;

revoke all on function public.confirm_suggestion_deletion(text) from public;
grant execute on function public.confirm_suggestion_deletion(text) to authenticated;
