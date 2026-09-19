-- ============================================================================
-- Add the two co-presidents
-- ============================================================================
-- This is the ONLY place the two real addresses need to exist: the
-- authorized_presidents table in your own Supabase project. They are not
-- needed in any environment variable, in this repository, or anywhere in
-- your deploy settings.
--
-- ┌────────────────────────────────────────────────────────────────────────┐
-- │  DO NOT COMMIT AN EDITED COPY OF THIS FILE.                            │
-- │                                                                        │
-- │  Copy it, replace the two placeholders in your editor, paste the       │
-- │  result into the Supabase SQL Editor, and run it there. Once it has    │
-- │  run, close the tab. Nothing needs saving.                             │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Run this AFTER the migrations in supabase/migrations/.
-- ============================================================================

insert into public.authorized_presidents (email, display_name)
values
  ('REPLACE_WITH_FIRST_CO_PRESIDENT_EMAIL',  'REPLACE_WITH_FIRST_NAME'),
  ('REPLACE_WITH_SECOND_CO_PRESIDENT_EMAIL', 'REPLACE_WITH_SECOND_NAME')
on conflict (lower(email)) do nothing;

-- Check it worked. This prints the addresses, so run it in your own SQL
-- Editor and nowhere that keeps a log.
select email, display_name, created_at
from public.authorized_presidents
order by created_at;

-- ---------------------------------------------------------------------------
-- Removing a president later (a graduating co-president, say)
-- ---------------------------------------------------------------------------
-- They lose access on their very next request. There is nothing else to
-- change anywhere.
--
--   delete from public.authorized_presidents
--   where lower(email) = lower('REPLACE_WITH_THE_ADDRESS_TO_REMOVE');
