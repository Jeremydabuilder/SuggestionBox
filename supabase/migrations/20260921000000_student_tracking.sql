-- Optional student accounts: a signed-in student may track only their own
-- non-anonymous suggestions. Anonymous submissions deliberately have no
-- owner link, even when the sender happens to be signed in.

alter table public.suggestions
  add column if not exists submitter_user_id uuid references auth.users (id) on delete set null;

create index if not exists suggestions_submitter_user_idx
  on public.suggestions (submitter_user_id, created_at desc)
  where submitter_user_id is not null;

alter table public.suggestions
  drop constraint if exists suggestions_anonymous_has_no_identity;

alter table public.suggestions
  add constraint suggestions_anonymous_has_no_identity
  check (
    not is_anonymous
    or (student_name is null and student_email is null and submitter_user_id is null)
  );

drop policy if exists "students can read own suggestions" on public.suggestions;
create policy "students can read own suggestions"
  on public.suggestions for select
  to authenticated
  using (submitter_user_id = auth.uid());

-- The original policy predates account ownership. Recreate it so a direct
-- API caller cannot attach a row to somebody else's user id.
drop policy if exists "students can insert suggestions" on public.suggestions;
create policy "students can insert suggestions"
  on public.suggestions for insert
  to anon, authenticated
  with check (
    status = 'new'
    and is_read = false
    and read_at is null
    and (submitter_user_id is null or submitter_user_id = auth.uid())
  );

-- authenticated already has SELECT from the initial migration. RLS keeps
-- each student on their own rows, while the president policy remains valid.
