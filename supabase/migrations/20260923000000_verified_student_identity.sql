-- ============================================================================
-- Verified student identity for new submissions
-- ============================================================================
-- From this migration forward, a new suggestion may only be inserted by a
-- signed-in student, under their own verified Supabase Auth identity. This
-- does NOT touch any existing row:
--   - Legacy anonymous rows keep is_anonymous = true and null identity
--     columns exactly as they are today. The pre-existing check constraint
--     `suggestions_anonymous_has_no_identity` (20260921000000) still allows
--     that shape; nothing here revokes it or rewrites those rows.
--   - Legacy non-anonymous rows are untouched.
--
-- What changes is only what a NEW insert must look like. RLS policies and
-- table grants apply to operations, not to rows already stored, so this is
-- safe to run against the live table at any time.
--
-- Run this in the Supabase SQL editor, or with `supabase db push`. It is
-- idempotent enough to re-run safely. Never edit an already-applied
-- migration — this file only replaces the insert policy from init.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Replace the insert policy: authenticated students only, and only under
-- their own verified identity.
-- ---------------------------------------------------------------------------
drop policy if exists "students can insert suggestions" on public.suggestions;
create policy "students can insert suggestions"
  on public.suggestions for insert
  to authenticated
  with check (
    status = 'new'
    and is_read = false
    and read_at is null
    and is_anonymous = false
    and submitter_user_id = auth.uid()
    and student_name is not null
    and char_length(btrim(student_name)) > 0
    and student_email is not null
    and lower(student_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- anon previously had INSERT on suggestions (the old "anonymous submission"
-- path). That grant is removed outright: an unauthenticated request can no
-- longer create a suggestion by any route, direct or otherwise.
revoke insert on public.suggestions from anon;

-- authenticated already has insert from init.sql; restate it so this file is
-- a complete, self-contained description of the new insert privilege.
grant insert on public.suggestions to authenticated;

-- ---------------------------------------------------------------------------
-- Verification queries — run these after applying, adjust the ids you use.
-- ---------------------------------------------------------------------------
-- 1. Confirm anon has no insert grant left:
--    select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'suggestions' and grantee = 'anon';
--    -- expect zero rows for privilege_type = 'INSERT'
--
-- 2. Confirm existing anonymous rows are still readable/untouched:
--    select count(*) from public.suggestions where is_anonymous = true;
--    -- expect the same count as before this migration
--
-- 3. As a signed-in student (via the app, not raw SQL): attempt to insert
--    with a forged submitter_user_id or a different student_email than the
--    session's own — expect "new row violates row-level security policy".
