-- ============================================================================
-- Duplicate detection
-- ============================================================================
-- Suggested, confirmed and dismissed relationships between suggestions, plus
-- a canonical ("primary") suggestion that duplicates can be linked to.
--
-- Nothing in here deletes, archives, merges or rejects anything. Every
-- original submission and its submitter details are preserved exactly as
-- sent; a relationship is only ever a note about two rows, and a president
-- makes every decision.
--
-- The existing RLS model is unchanged and extended the same way: students
-- (the anon role) get no privileges on any of this at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The state of a relationship between two suggestions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'match_state') then
    create type public.match_state as enum (
      'suggested',   -- found by the detector, nobody has looked yet
      'confirmed',   -- a president says these really are the same idea
      'dismissed'    -- a president says they are not; never show it again
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Suggested / confirmed / dismissed relationships
-- ---------------------------------------------------------------------------
create table if not exists public.suggestion_matches (
  id            uuid primary key default gen_random_uuid(),
  -- The pair is stored in a fixed order so that one relationship is one row
  -- no matter which of the two suggestions was submitted first.
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  match_id      uuid not null references public.suggestions (id) on delete cascade,
  score         numeric(4, 3) not null check (score >= 0 and score <= 1),
  -- The parts the score was built from, kept so a president can see why a
  -- pair was flagged, and so a future scoring method can be compared.
  breakdown     jsonb not null default '{}'::jsonb,
  -- Which method produced this score. A later semantic method writes its own
  -- name here, so old and new scores stay tellable apart.
  method        text not null default 'lexical-v1',
  state         public.match_state not null default 'suggested',
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint suggestion_matches_distinct check (suggestion_id <> match_id),
  constraint suggestion_matches_ordered check (suggestion_id < match_id),
  constraint suggestion_matches_pair unique (suggestion_id, match_id)
);

create index if not exists suggestion_matches_suggestion_idx on public.suggestion_matches (suggestion_id);
create index if not exists suggestion_matches_match_idx      on public.suggestion_matches (match_id);
create index if not exists suggestion_matches_state_idx      on public.suggestion_matches (state);

drop trigger if exists suggestion_matches_touch_updated_at on public.suggestion_matches;
create trigger suggestion_matches_touch_updated_at
  before update on public.suggestion_matches
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The canonical suggestion of a group
-- ---------------------------------------------------------------------------
-- A duplicate points at the one suggestion the presidents are tracking the
-- idea under. The duplicate itself is never altered otherwise: its text,
-- status, name and email all stay exactly as submitted.
alter table public.suggestions
  add column if not exists primary_suggestion_id uuid references public.suggestions (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'suggestions_primary_not_self'
  ) then
    alter table public.suggestions
      add constraint suggestions_primary_not_self
      check (primary_suggestion_id is null or primary_suggestion_id <> id);
  end if;
end
$$;

create index if not exists suggestions_primary_idx
  on public.suggestions (primary_suggestion_id)
  where primary_suggestion_id is not null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.suggestion_matches enable row level security;

-- Students can never read, write or even count duplicate data.
revoke all on public.suggestion_matches from anon, authenticated;
grant select, insert, update on public.suggestion_matches to authenticated;
-- Deliberately no DELETE: a dismissed match is kept as a record of the
-- decision, so the detector cannot quietly resurrect it later.

drop policy if exists "presidents can read matches" on public.suggestion_matches;
create policy "presidents can read matches"
  on public.suggestion_matches for select
  to authenticated
  using (public.is_president());

drop policy if exists "presidents can record matches" on public.suggestion_matches;
create policy "presidents can record matches"
  on public.suggestion_matches for insert
  to authenticated
  with check (public.is_president());

drop policy if exists "presidents can decide matches" on public.suggestion_matches;
create policy "presidents can decide matches"
  on public.suggestion_matches for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

-- ---------------------------------------------------------------------------
-- Realtime: a decision by one co-president reaches the other immediately.
-- Still subject to the policies above.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.suggestion_matches;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;
