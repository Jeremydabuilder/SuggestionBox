-- ============================================================================
-- Student Suggestion Box — initial schema
-- ============================================================================
-- Run this in the Supabase SQL editor, or with `supabase db push`.
-- It is idempotent enough to re-run safely on a fresh project.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'suggestion_category') then
    create type public.suggestion_category as enum (
      'events',
      'food',
      'school_spaces',
      'clubs_and_activities',
      'community',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'suggestion_status') then
    create type public.suggestion_status as enum (
      'new',
      'reviewing',
      'discussing',
      'approved',
      'in_progress',
      'completed',
      'declined',
      'archived'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Authorized president accounts
-- ---------------------------------------------------------------------------
create table if not exists public.authorized_presidents (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  display_name text,
  created_at  timestamptz not null default now()
);

-- Emails are compared case-insensitively everywhere.
create unique index if not exists authorized_presidents_email_key
  on public.authorized_presidents (lower(email));

-- ---------------------------------------------------------------------------
-- 2. Suggestions
-- ---------------------------------------------------------------------------
create table if not exists public.suggestions (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 3 and 120),
  description        text not null check (char_length(description) between 20 and 2000),
  category           public.suggestion_category not null,
  improvement_reason text not null check (char_length(improvement_reason) between 10 and 1000),
  student_name       text check (student_name is null or char_length(student_name) <= 80),
  student_email      text check (student_email is null or char_length(student_email) <= 160),
  is_anonymous       boolean not null default false,
  status             public.suggestion_status not null default 'new',
  is_read            boolean not null default false,
  read_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- An anonymous submission must never carry identifying details.
  constraint suggestions_anonymous_has_no_identity
    check (not is_anonymous or (student_name is null and student_email is null))
);

create index if not exists suggestions_created_at_idx on public.suggestions (created_at desc);
create index if not exists suggestions_status_idx     on public.suggestions (status);
create index if not exists suggestions_category_idx   on public.suggestions (category);
create index if not exists suggestions_is_read_idx    on public.suggestions (is_read);

-- ---------------------------------------------------------------------------
-- 3. Internal notes (shared between the two co-presidents)
-- ---------------------------------------------------------------------------
create table if not exists public.internal_notes (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  author_email  text not null,
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);

create index if not exists internal_notes_suggestion_idx
  on public.internal_notes (suggestion_id, created_at asc);

-- ---------------------------------------------------------------------------
-- 4. Status history
-- ---------------------------------------------------------------------------
create table if not exists public.status_history (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  from_status   public.suggestion_status,
  to_status     public.suggestion_status not null,
  changed_by    text,
  created_at    timestamptz not null default now()
);

create index if not exists status_history_suggestion_idx
  on public.status_history (suggestion_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Submission log (server-side rate limiting)
-- ---------------------------------------------------------------------------
create table if not exists public.submission_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

create index if not exists submission_log_ip_hash_created_idx
  on public.submission_log (ip_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Digest bookkeeping (one summary email per day, at most)
-- ---------------------------------------------------------------------------
create table if not exists public.digest_runs (
  id          uuid primary key default gen_random_uuid(),
  sent_for    date not null unique,
  unread_count integer not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: is the current session one of the authorized co-presidents?
-- ---------------------------------------------------------------------------
create or replace function public.is_president()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.authorized_presidents ap
    where lower(ap.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_president() from public;
grant execute on function public.is_president() to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: keep updated_at fresh and record every status change
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists suggestions_touch_updated_at on public.suggestions;
create trigger suggestions_touch_updated_at
  before update on public.suggestions
  for each row execute function public.touch_updated_at();

create or replace function public.record_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.status_history (suggestion_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, null);
  elsif new.status is distinct from old.status then
    insert into public.status_history (suggestion_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.jwt() ->> 'email');
  end if;
  return new;
end;
$$;

drop trigger if exists suggestions_record_status_insert on public.suggestions;
create trigger suggestions_record_status_insert
  after insert on public.suggestions
  for each row execute function public.record_status_change();

drop trigger if exists suggestions_record_status_update on public.suggestions;
create trigger suggestions_record_status_update
  after update of status on public.suggestions
  for each row execute function public.record_status_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.suggestions            enable row level security;
alter table public.internal_notes         enable row level security;
alter table public.status_history         enable row level security;
alter table public.authorized_presidents  enable row level security;
alter table public.submission_log         enable row level security;
alter table public.digest_runs            enable row level security;

-- suggestions: anonymous students may INSERT only. No select/update/delete.
drop policy if exists "students can insert suggestions" on public.suggestions;
create policy "students can insert suggestions"
  on public.suggestions for insert
  to anon, authenticated
  with check (
    status = 'new'
    and is_read = false
    and read_at is null
  );

drop policy if exists "presidents can read suggestions" on public.suggestions;
create policy "presidents can read suggestions"
  on public.suggestions for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can update suggestions" on public.suggestions;
create policy "presidents can update suggestions"
  on public.suggestions for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

-- Nobody (other than the service role) may delete a suggestion.

-- internal_notes: presidents only, and a note is always written under
-- the author's own signed-in email address.
drop policy if exists "presidents can read notes" on public.internal_notes;
create policy "presidents can read notes"
  on public.internal_notes for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can write notes" on public.internal_notes;
create policy "presidents can write notes"
  on public.internal_notes for insert
  to authenticated
  with check (
    public.is_president()
    and lower(author_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "presidents can delete own notes" on public.internal_notes;
create policy "presidents can delete own notes"
  on public.internal_notes for delete
  to authenticated
  using (
    public.is_president()
    and lower(author_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- status_history: presidents may read. Rows are only ever written by the
-- security-definer trigger above.
drop policy if exists "presidents can read status history" on public.status_history;
create policy "presidents can read status history"
  on public.status_history for select
  to authenticated
  using (public.is_president());

-- authorized_presidents: a president may read the roster (to see their
-- co-president). No client may modify it — that is a service-role/SQL job.
drop policy if exists "presidents can read roster" on public.authorized_presidents;
create policy "presidents can read roster"
  on public.authorized_presidents for select
  to authenticated
  using (public.is_president());

-- submission_log / digest_runs: no client policies at all. Service role only.

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
-- RLS decides which ROWS are visible; these GRANTs decide which OPERATIONS
-- are even offered. Both are stated explicitly rather than inherited from
-- Supabase's default privileges.
-- ---------------------------------------------------------------------------
revoke all on public.suggestions           from anon, authenticated;
revoke all on public.internal_notes        from anon, authenticated;
revoke all on public.status_history        from anon, authenticated;
revoke all on public.authorized_presidents from anon, authenticated;
revoke all on public.submission_log        from anon, authenticated;
revoke all on public.digest_runs           from anon, authenticated;

-- A student may only ever add a suggestion.
grant insert on public.suggestions to anon, authenticated;

-- A signed-in president reads and updates suggestions, and keeps notes.
grant select, update on public.suggestions          to authenticated;
grant select, insert, delete on public.internal_notes to authenticated;
grant select on public.status_history               to authenticated;
grant select on public.authorized_presidents        to authenticated;

-- submission_log and digest_runs stay service-role only.

-- ---------------------------------------------------------------------------
-- Realtime: both co-presidents see each other's updates live.
-- Realtime still honours the RLS policies above.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.suggestions;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.internal_notes;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.status_history;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;
