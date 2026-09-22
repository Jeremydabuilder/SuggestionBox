-- ============================================================================
-- Trash and permanent deletion
-- ============================================================================
-- A recoverable soft-delete stage that is deliberately separate from the
-- existing 'archived' status. Archive is a normal, fully-visible status a
-- president chooses like any other; Trash is a protected holding area that
-- is excluded from every ordinary read path (inbox, dashboard counts,
-- duplicate scans, agent search, trends, clusters, meeting prep, proposal
-- builder, since-last-meeting) by Row Level Security itself, not by every
-- call site remembering to add a filter. Nothing here changes what
-- 'archived' means or does.
--
-- Every mutation below (trash, restore, request-deletion, confirm-deletion)
-- goes through a narrowly-scoped SECURITY DEFINER function rather than a
-- raw table UPDATE/DELETE, exactly like the existing is_president() /
-- record_status_change() pattern: the function runs with the owning role's
-- elevated privilege (the same role of trust this project already gives a
-- service-role key), but re-checks is_president() itself on every call, so
-- a valid president session is still required for every step. No bulk
-- permanent deletion exists anywhere in this file — one suggestion, one
-- confirmation token, one delete.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trash columns on suggestions
-- ---------------------------------------------------------------------------
alter table public.suggestions
  add column if not exists trashed_at    timestamptz,
  add column if not exists trashed_by    text,
  add column if not exists trash_reason  text check (trash_reason is null or char_length(trash_reason) <= 500);

create index if not exists suggestions_trashed_at_idx
  on public.suggestions (trashed_at desc)
  where trashed_at is not null;

-- ---------------------------------------------------------------------------
-- 2. RLS: a trashed suggestion is invisible to every ordinary read
-- ---------------------------------------------------------------------------
-- Replaces the original "presidents can read/update suggestions" policies
-- with versions that additionally require trashed_at is null. Every
-- existing select/update in the app (inbox, dashboard, duplicate scans,
-- agent tools, trends, clusters, meeting prep, proposal builder,
-- since-last-meeting, promise tracker) uses the ordinary session-scoped
-- client and this exact table, so all of them are excluded from trash
-- automatically — no call site needed to change.
drop policy if exists "presidents can read suggestions" on public.suggestions;
create policy "presidents can read suggestions"
  on public.suggestions for select
  to authenticated
  using (public.is_president() and trashed_at is null);

drop policy if exists "presidents can update suggestions" on public.suggestions;
create policy "presidents can update suggestions"
  on public.suggestions for update
  to authenticated
  using (public.is_president() and trashed_at is null)
  with check (public.is_president());

-- Still true, and now the only way in or out of trashed_at at all: nobody
-- (other than the owner of the functions below) may delete a suggestion,
-- and no ordinary client update can set or clear trashed_at — only
-- trash_suggestion() / restore_suggestion() / confirm_suggestion_deletion()
-- can, because those run as SECURITY DEFINER and bypass RLS.

-- ---------------------------------------------------------------------------
-- 3. One-time permanent-deletion confirmation tokens
-- ---------------------------------------------------------------------------
-- No client policies at all — written and read only by the SECURITY
-- DEFINER functions below, the same trust boundary already used for
-- submission_log and digest_runs.
create table if not exists public.suggestion_deletion_tokens (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  token         text not null unique,
  requested_by  text not null,
  requested_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);

create index if not exists suggestion_deletion_tokens_suggestion_idx
  on public.suggestion_deletion_tokens (suggestion_id);

alter table public.suggestion_deletion_tokens enable row level security;
revoke all on public.suggestion_deletion_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Minimal, content-free permanent-deletion audit log
-- ---------------------------------------------------------------------------
-- Deliberately carries no student name, email, title, description, or any
-- other deleted content — only that a deletion happened, of what category,
-- by whom, when, and how many dependent rows (notes/history/matches/
-- citations) went with it. No foreign key to suggestions: the row this
-- refers to no longer exists once this is written, and the audit record
-- must survive that.
create table if not exists public.suggestion_deletion_audit (
  id                       uuid primary key default gen_random_uuid(),
  deleted_suggestion_id    uuid not null,
  suggestion_category      public.suggestion_category not null,
  performed_by             text not null,
  performed_at             timestamptz not null default now(),
  dependent_notes_count    integer not null default 0,
  dependent_history_count  integer not null default 0,
  dependent_match_count    integer not null default 0,
  dependent_citation_count integer not null default 0
);

alter table public.suggestion_deletion_audit enable row level security;
revoke all on public.suggestion_deletion_audit from anon, authenticated;
grant select on public.suggestion_deletion_audit to authenticated;

drop policy if exists "presidents can read the deletion audit log" on public.suggestion_deletion_audit;
create policy "presidents can read the deletion audit log"
  on public.suggestion_deletion_audit for select
  to authenticated
  using (public.is_president());

-- ---------------------------------------------------------------------------
-- 5. list_trashed_suggestions() — the only way to see what's in Trash
-- ---------------------------------------------------------------------------
create or replace function public.list_trashed_suggestions()
returns table (
  id           uuid,
  title        text,
  category     public.suggestion_category,
  status       public.suggestion_status,
  trashed_at   timestamptz,
  trashed_by   text,
  trash_reason text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.title, s.category, s.status, s.trashed_at, s.trashed_by, s.trash_reason, s.created_at
  from public.suggestions s
  where s.trashed_at is not null
    and public.is_president()
  order by s.trashed_at desc;
$$;

revoke all on function public.list_trashed_suggestions() from public;
grant execute on function public.list_trashed_suggestions() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. trash_suggestion() — move to Trash
-- ---------------------------------------------------------------------------
create or replace function public.trash_suggestion(p_suggestion_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_president() then
    raise exception 'Not authorized.';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  update public.suggestions
  set trashed_at   = now(),
      trashed_by   = lower(coalesce(auth.jwt() ->> 'email', '')),
      trash_reason = v_reason
  where id = p_suggestion_id
    and trashed_at is null;

  if not found then
    raise exception 'That suggestion could not be moved to Trash — it may already be there, or no longer exist.';
  end if;
end;
$$;

revoke all on function public.trash_suggestion(uuid, text) from public;
grant execute on function public.trash_suggestion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. restore_suggestion() — undo a Trash, full data-integrity preservation
-- ---------------------------------------------------------------------------
-- A plain field reset, not an insert — so restoring can never create a
-- duplicate row, and never adds a spurious status_history entry (that
-- trigger only fires on a change to the status column, which this never
-- touches).
create or replace function public.restore_suggestion(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized.';
  end if;

  update public.suggestions
  set trashed_at   = null,
      trashed_by   = null,
      trash_reason = null
  where id = p_suggestion_id
    and trashed_at is not null;

  if not found then
    raise exception 'That suggestion could not be restored — it may not be in Trash, or no longer exists.';
  end if;

  -- Any pending, unused deletion tokens for this suggestion no longer apply.
  delete from public.suggestion_deletion_tokens
  where suggestion_id = p_suggestion_id
    and used_at is null;
end;
$$;

revoke all on function public.restore_suggestion(uuid) from public;
grant execute on function public.restore_suggestion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. request_suggestion_deletion() — step 1 of permanent deletion
-- ---------------------------------------------------------------------------
-- Issues a single-use, short-lived, opaque confirmation token. Requires
-- the suggestion to already be in Trash — permanent deletion is only ever
-- reachable from there, never straight off the inbox. Any earlier unused
-- token for this suggestion is invalidated first, so only the most
-- recently requested confirmation can ever be consumed.
create or replace function public.request_suggestion_deletion(p_suggestion_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token      text;
  v_expires_at timestamptz := now() + interval '5 minutes';
begin
  if not public.is_president() then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1 from public.suggestions
    where id = p_suggestion_id and trashed_at is not null
  ) then
    raise exception 'That suggestion must be in Trash before it can be permanently deleted.';
  end if;

  delete from public.suggestion_deletion_tokens
  where suggestion_id = p_suggestion_id
    and used_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.suggestion_deletion_tokens (suggestion_id, token, requested_by, expires_at)
  values (p_suggestion_id, v_token, lower(coalesce(auth.jwt() ->> 'email', '')), v_expires_at);

  return query select v_token, v_expires_at;
end;
$$;

revoke all on function public.request_suggestion_deletion(uuid) from public;
grant execute on function public.request_suggestion_deletion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. confirm_suggestion_deletion() — step 2: irreversible, transactional
-- ---------------------------------------------------------------------------
-- Re-validates everything at the moment of deletion (fresh session via
-- is_president(), token unused, token unexpired, suggestion still exists
-- and is still trashed) rather than trusting anything decided earlier in
-- the flow. Every dependent row (notes, history, match relationships,
-- meeting citations) is removed automatically by the existing ON DELETE
-- CASCADE foreign keys — this function does not enumerate or delete them
-- itself, only counts them first for the audit record. A function body in
-- Postgres runs inside the calling statement's own transaction, so the
-- count, the audit insert, and the delete either all happen or none do.
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

  insert into public.suggestion_deletion_audit (
    deleted_suggestion_id, suggestion_category, performed_by,
    dependent_notes_count, dependent_history_count, dependent_match_count, dependent_citation_count
  ) values (
    v_token_row.suggestion_id, v_category, lower(coalesce(auth.jwt() ->> 'email', '')),
    v_notes_count, v_history_count, v_match_count, v_citation_count
  );

  delete from public.suggestions where id = v_token_row.suggestion_id;
end;
$$;

revoke all on function public.confirm_suggestion_deletion(text) from public;
grant execute on function public.confirm_suggestion_deletion(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. A trashed suggestion is also invisible to the student who sent it
-- ---------------------------------------------------------------------------
-- "students can read own suggestions" (student_tracking migration) is a
-- second, independently OR'd SELECT policy on this table — excluding trash
-- from the president policy alone would leave a signed-in student's own
-- ordinary My Ideas query still returning the full row, trash_reason and
-- trashed_by included. This closes that gap the same way.
drop policy if exists "students can read own suggestions" on public.suggestions;
create policy "students can read own suggestions"
  on public.suggestions for select
  to authenticated
  using (submitter_user_id = auth.uid() and trashed_at is null);

-- The only thing My Ideas is allowed to know about its own trashed items:
-- how many, never which ones, never why, never who removed them.
create or replace function public.count_my_removed_suggestions()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.suggestions
  where submitter_user_id = auth.uid()
    and trashed_at is not null;
$$;

revoke all on function public.count_my_removed_suggestions() from public;
grant execute on function public.count_my_removed_suggestions() to authenticated;
