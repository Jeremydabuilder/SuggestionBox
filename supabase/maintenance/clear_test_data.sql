-- ============================================================================
-- Clear test submissions before opening the box to students
-- ============================================================================
-- Run this ONCE, by hand, in the Supabase SQL editor, against the project you
-- are about to launch — and only if you submitted test suggestions into it
-- while setting up. A brand-new Supabase project has nothing to clean.
--
-- There is deliberately NO button for this in the dashboard. Emptying the
-- suggestion box is not something anyone should be able to do by misclicking
-- while reading students' ideas, so it lives here, off to one side, and takes
-- a decision to run.
--
-- The file is safe to run as-is: STEP 1 only shows you what STEP 2 would
-- remove. STEP 2 is commented out. Read the output, then uncomment and run
-- it if — and only if — you agree with every row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — review. Change nothing yet.
-- ---------------------------------------------------------------------------
-- Everything currently in the box, oldest first, so you can see exactly what
-- is there before deciding.
select
  created_at,
  status,
  category,
  title,
  coalesce(student_name, case when is_anonymous then '(anonymous)' else '(no name)' end)
    as submitted_by,
  left(description, 60) || '…' as description_start
from public.suggestions
order by created_at asc;

-- A count, so a surprising number is obvious before you touch anything.
select count(*) as suggestions_in_the_box from public.suggestions;

-- ---------------------------------------------------------------------------
-- STEP 2 — remove. Uncomment ONE of these, never both.
-- ---------------------------------------------------------------------------
-- Internal notes, status history and duplicate matches are all removed
-- automatically with their suggestion (ON DELETE CASCADE), so deleting the
-- suggestions is enough.
--
-- Option A — everything submitted before you went live. Set the cutoff to
-- the moment you finished setting up, in UTC. This is usually what you want.
--
--   delete from public.suggestions
--   where created_at < timestamptz '2026-01-15 00:00:00+00';
--
-- Option B — a specific list of test titles you recognise. Safer when real
-- submissions have already started arriving and you only want the test ones.
--
--   delete from public.suggestions
--   where title in (
--     'Test suggestion',
--     'A quiet corner in the library'
--   );
--
-- Option C — a completely empty box, for a project that has never been live.
-- This removes EVERY suggestion, including real ones. There is no undo.
--
--   truncate table public.suggestions cascade;

-- ---------------------------------------------------------------------------
-- STEP 3 — tidy the supporting tables (optional)
-- ---------------------------------------------------------------------------
-- The rate-limit log holds only salted IP hashes and times, and prunes
-- nothing on its own. Clearing it resets every student's submission
-- allowance, which is usually what you want on launch day.
--
--   delete from public.submission_log;
--
-- If you tested the daily digest, clear its record of having sent today's,
-- so the first real digest is not suppressed.
--
--   delete from public.digest_runs;

-- ---------------------------------------------------------------------------
-- STEP 4 — confirm
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.suggestions)        as suggestions,
  (select count(*) from public.suggestion_matches) as duplicate_matches,
  (select count(*) from public.internal_notes)     as notes,
  (select count(*) from public.status_history)     as history_rows,
  (select count(*) from public.submission_log)     as rate_limit_rows;
