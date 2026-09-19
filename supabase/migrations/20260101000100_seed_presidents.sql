-- ============================================================================
-- Authorize the two student-government co-presidents.
-- ============================================================================
-- Replace the two addresses below with the real co-president email addresses,
-- then run this file in the Supabase SQL editor.
--
-- These must be the SAME addresses you put in PRESIDENT_EMAILS in your
-- environment variables. The app checks both places.
-- ============================================================================

insert into public.authorized_presidents (email, display_name)
values
  ('co-president-one@example.org', 'Co-President One'),
  ('co-president-two@example.org', 'Co-President Two')
on conflict (lower(email)) do nothing;
