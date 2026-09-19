-- ============================================================================
-- Undoing a dismissed duplicate match
-- ============================================================================
-- A president can decide they were wrong to dismiss a pair. The reversal is
-- recorded rather than hidden: who dismissed it and when stays in
-- decided_by / decided_at, and who reopened it and when goes in the two new
-- columns. The row is never deleted, so the whole decision trail survives.
-- ============================================================================

alter table public.suggestion_matches
  add column if not exists reopened_by text,
  add column if not exists reopened_at timestamptz;

comment on column public.suggestion_matches.decided_by is
  'The president who last confirmed or dismissed this pair.';
comment on column public.suggestion_matches.reopened_by is
  'The president who last undid a dismissal, if one has been undone.';
comment on column public.suggestion_matches.reopened_at is
  'When that reversal happened.';

-- No new privileges are needed: the existing "presidents can decide matches"
-- UPDATE policy already covers this, and students still have none.
