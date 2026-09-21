-- ============================================================================
-- AI Workspace — persistent tables only
-- ============================================================================
-- Scope of this migration (deliberately limited):
--   - Saved meeting briefs (plus their approved cleaned notes/summary text)
--   - Decisions
--   - Action items
--   - The three suggestion-citation join tables
--
-- What this migration does NOT create, on purpose:
--   - No table for raw transcripts or in-progress cleanup review. Those stay
--     in client state until a president explicitly approves and saves.
--   - No audio/recording storage of any kind. Recorded audio is transcribed
--     server-side and discarded; it is never written to Postgres.
--   - No owner/assignee column anywhere in meeting_actions.
--
-- Run this in the Supabase SQL editor, or with `supabase db push`. It is
-- idempotent enough to re-run safely. Never edit an already-applied
-- migration — this file only adds to the schema from 20260101000000_init.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'meeting_state') then
    create type public.meeting_state as enum ('draft', 'saved', 'archived');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Saved meeting briefs
-- ---------------------------------------------------------------------------
-- One row per meeting a president has actually saved. Everything AI-proposed
-- lives only in the browser until a president clicks Save — nothing here is
-- ever written by a server action that isn't handling an explicit save.
--
-- `agenda`, `quick_wins`, `decisions_needed`, `follow_ups`, and `watchouts`
-- hold the president-approved planning content as JSON (title/summary/text
-- fields only — no suggestion identifiers inside the JSON; every cited
-- suggestion is recorded as a real foreign-keyed row in
-- meeting_brief_citations instead, so a citation can never point at a
-- suggestion that doesn't exist or that this president cannot see).
--
-- `approved_cleaned_notes` and `approved_summary` hold the output of the
-- Meeting Cleanup + Recorder/Summarizer flow, but only once a president has
-- reviewed and approved it. The raw transcript itself is never stored here
-- (see the migration header). Both columns are nullable because a saved
-- meeting may exist from Meeting Prep alone, with no recorded discussion yet.
create table if not exists public.meeting_briefs (
  id                  uuid primary key default gen_random_uuid(),
  headline            text not null check (char_length(headline) between 1 and 200),
  executive_summary   text not null check (char_length(executive_summary) between 1 and 4000),
  scope               text check (scope in ('new', 'active', 'all')),
  state               public.meeting_state not null default 'saved',
  agenda              jsonb not null default '[]'::jsonb,
  quick_wins          jsonb not null default '[]'::jsonb,
  decisions_needed    jsonb not null default '[]'::jsonb,
  follow_ups          jsonb not null default '[]'::jsonb,
  watchouts           jsonb not null default '[]'::jsonb,
  approved_cleaned_notes text check (approved_cleaned_notes is null or char_length(approved_cleaned_notes) <= 20000),
  approved_summary       text check (approved_summary is null or char_length(approved_summary) <= 8000),
  created_by          text not null,
  created_at          timestamptz not null default now(),
  updated_by          text not null,
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);

create index if not exists meeting_briefs_state_created_idx
  on public.meeting_briefs (state, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Decisions
-- ---------------------------------------------------------------------------
-- Manually recorded by either co-president. AI may propose a decision
-- question for discussion, but nothing lands here except through an explicit
-- save action, and the row's own text is always what the president confirmed
-- — never raw model output.
create table if not exists public.meeting_decisions (
  id             uuid primary key default gen_random_uuid(),
  decision_text  text not null check (char_length(decision_text) between 1 and 2000),
  meeting_id     uuid references public.meeting_briefs (id) on delete set null,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  updated_by     text not null,
  updated_at     timestamptz not null default now()
);

-- Documented FK behavior: deleting a meeting brief does NOT delete its
-- decisions. The decision text, author, and timestamps are kept; only the
-- link back to that meeting is cleared (meeting_id -> null). This matches
-- "prefer archiving meetings" — a decision remains true and on the record
-- even if the meeting that produced it is later removed.
create index if not exists meeting_decisions_meeting_idx
  on public.meeting_decisions (meeting_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Action items
-- ---------------------------------------------------------------------------
-- No owner/assignee/assigned_to column exists here, or anywhere else in this
-- migration, by explicit product requirement. Action items are a shared list
-- both co-presidents read and complete together.
create table if not exists public.meeting_actions (
  id             uuid primary key default gen_random_uuid(),
  action_text    text not null check (char_length(action_text) between 1 and 2000),
  deadline       date,
  completed      boolean not null default false,
  completed_at   timestamptz,
  meeting_id     uuid references public.meeting_briefs (id) on delete set null,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  updated_by     text not null,
  updated_at     timestamptz not null default now(),
  constraint meeting_actions_completed_at_matches_flag
    check ((completed and completed_at is not null) or (not completed and completed_at is null))
);

-- Same documented FK behavior as decisions: deleting a meeting brief clears
-- meeting_id on its action items rather than deleting them.
create index if not exists meeting_actions_meeting_idx
  on public.meeting_actions (meeting_id, created_at desc);
create index if not exists meeting_actions_completed_idx
  on public.meeting_actions (completed, deadline);

-- ---------------------------------------------------------------------------
-- 4. Citation join tables (one per parent type, not one polymorphic table)
-- ---------------------------------------------------------------------------
-- Postgres cannot enforce a foreign key against "one of several tables", so
-- each citable parent gets its own join table with two real foreign keys.
-- Deleting the parent (brief/decision/action) or the cited suggestion always
-- just removes the citation row — never the suggestion itself, and never a
-- meeting/decision/action as a side effect of citation cleanup.
create table if not exists public.meeting_brief_citations (
  id            uuid primary key default gen_random_uuid(),
  brief_id      uuid not null references public.meeting_briefs (id) on delete cascade,
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint meeting_brief_citations_unique unique (brief_id, suggestion_id)
);

create table if not exists public.meeting_decision_citations (
  id            uuid primary key default gen_random_uuid(),
  decision_id   uuid not null references public.meeting_decisions (id) on delete cascade,
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint meeting_decision_citations_unique unique (decision_id, suggestion_id)
);

create table if not exists public.meeting_action_citations (
  id            uuid primary key default gen_random_uuid(),
  action_id     uuid not null references public.meeting_actions (id) on delete cascade,
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint meeting_action_citations_unique unique (action_id, suggestion_id)
);

create index if not exists meeting_brief_citations_suggestion_idx
  on public.meeting_brief_citations (suggestion_id);
create index if not exists meeting_decision_citations_suggestion_idx
  on public.meeting_decision_citations (suggestion_id);
create index if not exists meeting_action_citations_suggestion_idx
  on public.meeting_action_citations (suggestion_id);

-- ---------------------------------------------------------------------------
-- Authorship enforcement: the database decides created_by/updated_by, not
-- the browser. Any client-supplied value for these columns is overwritten.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_workspace_authorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.created_by := current_email;
    new.updated_by := current_email;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    -- created_by/created_at are immutable after insert, whatever the client sends.
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := current_email;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_workspace_authorship() from public;

drop trigger if exists meeting_briefs_authorship on public.meeting_briefs;
create trigger meeting_briefs_authorship
  before insert or update on public.meeting_briefs
  for each row execute function public.enforce_workspace_authorship();

drop trigger if exists meeting_decisions_authorship on public.meeting_decisions;
create trigger meeting_decisions_authorship
  before insert or update on public.meeting_decisions
  for each row execute function public.enforce_workspace_authorship();

drop trigger if exists meeting_actions_authorship on public.meeting_actions;
create trigger meeting_actions_authorship
  before insert or update on public.meeting_actions
  for each row execute function public.enforce_workspace_authorship();

-- meeting_actions.completed_at: set/cleared automatically from `completed`,
-- so a client cannot desynchronize the two.
create or replace function public.enforce_meeting_action_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.completed and (tg_op = 'INSERT' or not old.completed) then
    new.completed_at := now();
  elsif not new.completed then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_actions_completed_at on public.meeting_actions;
create trigger meeting_actions_completed_at
  before insert or update on public.meeting_actions
  for each row execute function public.enforce_meeting_action_completed_at();

-- meeting_briefs.archived_at: kept in sync with state, for a clean audit
-- trail of when a meeting was archived (and un-archived, if reopened).
create or replace function public.enforce_meeting_brief_archived_at()
returns trigger
language plpgsql
as $$
begin
  if new.state = 'archived' and (tg_op = 'INSERT' or old.state is distinct from 'archived') then
    new.archived_at := now();
  elsif new.state <> 'archived' then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_briefs_archived_at on public.meeting_briefs;
create trigger meeting_briefs_archived_at
  before insert or update on public.meeting_briefs
  for each row execute function public.enforce_meeting_brief_archived_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Every table below is presidents-only, full stop: anonymous users and any
-- signed-in account that is not in authorized_presidents get zero rows and
-- no write path, for every operation, with no exceptions. Unlike
-- internal_notes (authored/deleted by their own author only), workspace
-- records are a shared space either co-president may read and write, so
-- policies check only public.is_president() — never a specific author email.
alter table public.meeting_briefs            enable row level security;
alter table public.meeting_decisions         enable row level security;
alter table public.meeting_actions           enable row level security;
alter table public.meeting_brief_citations   enable row level security;
alter table public.meeting_decision_citations enable row level security;
alter table public.meeting_action_citations  enable row level security;

drop policy if exists "presidents can read meeting briefs" on public.meeting_briefs;
create policy "presidents can read meeting briefs"
  on public.meeting_briefs for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert meeting briefs" on public.meeting_briefs;
create policy "presidents can insert meeting briefs"
  on public.meeting_briefs for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can update meeting briefs" on public.meeting_briefs;
create policy "presidents can update meeting briefs"
  on public.meeting_briefs for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

drop policy if exists "presidents can delete meeting briefs" on public.meeting_briefs;
create policy "presidents can delete meeting briefs"
  on public.meeting_briefs for delete
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can read decisions" on public.meeting_decisions;
create policy "presidents can read decisions"
  on public.meeting_decisions for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert decisions" on public.meeting_decisions;
create policy "presidents can insert decisions"
  on public.meeting_decisions for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can update decisions" on public.meeting_decisions;
create policy "presidents can update decisions"
  on public.meeting_decisions for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

drop policy if exists "presidents can delete decisions" on public.meeting_decisions;
create policy "presidents can delete decisions"
  on public.meeting_decisions for delete
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can read actions" on public.meeting_actions;
create policy "presidents can read actions"
  on public.meeting_actions for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert actions" on public.meeting_actions;
create policy "presidents can insert actions"
  on public.meeting_actions for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can update actions" on public.meeting_actions;
create policy "presidents can update actions"
  on public.meeting_actions for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

drop policy if exists "presidents can delete actions" on public.meeting_actions;
create policy "presidents can delete actions"
  on public.meeting_actions for delete
  to authenticated
  using (public.is_president());

-- Citation tables: read/insert/delete only. There is nothing to "update" on
-- a citation — you either cite a suggestion or you don't.
drop policy if exists "presidents can read brief citations" on public.meeting_brief_citations;
create policy "presidents can read brief citations"
  on public.meeting_brief_citations for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert brief citations" on public.meeting_brief_citations;
create policy "presidents can insert brief citations"
  on public.meeting_brief_citations for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can delete brief citations" on public.meeting_brief_citations;
create policy "presidents can delete brief citations"
  on public.meeting_brief_citations for delete
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can read decision citations" on public.meeting_decision_citations;
create policy "presidents can read decision citations"
  on public.meeting_decision_citations for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert decision citations" on public.meeting_decision_citations;
create policy "presidents can insert decision citations"
  on public.meeting_decision_citations for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can delete decision citations" on public.meeting_decision_citations;
create policy "presidents can delete decision citations"
  on public.meeting_decision_citations for delete
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can read action citations" on public.meeting_action_citations;
create policy "presidents can read action citations"
  on public.meeting_action_citations for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can insert action citations" on public.meeting_action_citations;
create policy "presidents can insert action citations"
  on public.meeting_action_citations for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can delete action citations" on public.meeting_action_citations;
create policy "presidents can delete action citations"
  on public.meeting_action_citations for delete
  to authenticated
  using (public.is_president());

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
-- As in the initial migration: RLS decides which ROWS are visible, these
-- GRANTs decide which OPERATIONS are even offered. anon gets nothing at all
-- on any workspace table — there is no public-facing use of this data.
revoke all on public.meeting_briefs             from anon, authenticated;
revoke all on public.meeting_decisions          from anon, authenticated;
revoke all on public.meeting_actions            from anon, authenticated;
revoke all on public.meeting_brief_citations    from anon, authenticated;
revoke all on public.meeting_decision_citations from anon, authenticated;
revoke all on public.meeting_action_citations   from anon, authenticated;

grant select, insert, update, delete on public.meeting_briefs             to authenticated;
grant select, insert, update, delete on public.meeting_decisions          to authenticated;
grant select, insert, update, delete on public.meeting_actions            to authenticated;
grant select, insert, delete         on public.meeting_brief_citations    to authenticated;
grant select, insert, delete         on public.meeting_decision_citations to authenticated;
grant select, insert, delete         on public.meeting_action_citations   to authenticated;

-- No grants to anon on any table in this migration.

-- ---------------------------------------------------------------------------
-- Realtime: both co-presidents see each other's saved workspace changes live,
-- same as the existing suggestions/notes/status_history tables.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.meeting_briefs;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.meeting_decisions;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.meeting_actions;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;
