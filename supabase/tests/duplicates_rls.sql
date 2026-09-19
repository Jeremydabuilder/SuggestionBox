-- ============================================================================
-- Duplicate detection: access control and decision behaviour
-- ============================================================================
-- Run against a database that has had both migrations applied:
--
--   psql "$DATABASE_URL" -f supabase/tests/duplicates_rls.sql
--
-- Checks print PASS or FAIL. Statements that are SUPPOSED to be refused are
-- wrapped in a savepoint, so one expected error does not abort the rest.
-- The whole file runs in a transaction that is rolled back, so it leaves no
-- data behind.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off
\set QUIET on
begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.authorized_presidents (email, display_name)
values ('rls.prez@school.test', 'Test President')
on conflict do nothing;

insert into public.suggestions (title, description, category, improvement_reason)
values (
  'RLSTEST longer lunch period',
  'We only get twenty minutes for lunch and the queue takes most of it.',
  'food',
  'More students would get to eat a full meal each day.'
) returning id as first_id \gset

insert into public.suggestions (title, description, category, improvement_reason)
values (
  'RLSTEST longer lunch periods',
  'Lunch is twenty minutes and most of that is spent queueing.',
  'food',
  'Students would get to finish their meal.'
) returning id as second_id \gset

-- A match, stored with the lower id first, exactly as the app writes it.
insert into public.suggestion_matches (suggestion_id, match_id, score, breakdown, method)
select least(:'first_id'::uuid, :'second_id'::uuid),
       greatest(:'first_id'::uuid, :'second_id'::uuid),
       0.91,
       '{"sharedKeywords":["lunch","period"]}'::jsonb,
       'lexical-v1'
returning id as match_id \gset

\set QUIET off
\set refused 'savepoint expect_refusal;'
\set recover 'rollback to savepoint expect_refusal;'

-- ---------------------------------------------------------------------------
-- 1. Students cannot reach duplicate data at all
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 1. anon (a student) and duplicate data ==='
set role anon;
set request.jwt.claims = '{}';

\echo '-- reading matches (expect: permission denied)'
:refused
select count(*) from public.suggestion_matches;
:recover

\echo '-- inventing a match (expect: permission denied)'
:refused
insert into public.suggestion_matches (suggestion_id, match_id, score)
values (:'first_id', :'second_id', 1.0);
:recover

\echo '-- reading who is filed under whom (expect: permission denied)'
:refused
select primary_suggestion_id from public.suggestions;
:recover

reset role;

-- ---------------------------------------------------------------------------
-- 2. A signed-in non-president sees nothing
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 2. authenticated, but not a president ==='
set role authenticated;
set request.jwt.claims = '{"email":"outsider@school.test"}';

select case when count(*) = 0 then 'PASS: sees no matches'
            else 'FAIL: saw ' || count(*) || ' matches' end as result
from public.suggestion_matches;

update public.suggestion_matches set state = 'confirmed';
reset role;
select case when count(*) = 0 then 'PASS: an outsider''s update changed nothing'
            else 'FAIL: outsider changed ' || count(*) || ' rows' end as result
from public.suggestion_matches where state = 'confirmed';

-- ---------------------------------------------------------------------------
-- 3. A president can read and decide
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 3. a co-president ==='
set role authenticated;
set request.jwt.claims = '{"email":"rls.prez@school.test"}';

select case when count(*) = 1 then 'PASS: sees the match'
            else 'FAIL: saw ' || count(*) end as result
from public.suggestion_matches where id = :'match_id';

update public.suggestion_matches
set state = 'dismissed', decided_by = 'rls.prez@school.test', decided_at = now()
where id = :'match_id';

select case when state = 'dismissed' and decided_by = 'rls.prez@school.test'
            then 'PASS: dismissal recorded, with who decided it'
            else 'FAIL: state=' || state end as result
from public.suggestion_matches where id = :'match_id';

-- ---------------------------------------------------------------------------
-- 4. A dismissed match is kept, not deleted, so it cannot be re-raised
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 4. a dismissed match stays dismissed ==='
\echo '-- deleting it (expect: permission denied)'
:refused
delete from public.suggestion_matches where id = :'match_id';
:recover

select case when count(*) = 1 then 'PASS: the dismissal is still on record'
            else 'FAIL: the row is gone' end as result
from public.suggestion_matches where id = :'match_id' and state = 'dismissed';

-- The dashboard query is `state <> 'dismissed'`, so this is what it sees.
select case when count(*) = 0 then 'PASS: it no longer appears in the dashboard query'
            else 'FAIL: it would still be shown' end as result
from public.suggestion_matches
where id = :'match_id' and state <> 'dismissed';

-- ---------------------------------------------------------------------------
-- 5. A manual link survives, and nothing is deleted or merged
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 5. filing one suggestion under another ==='
update public.suggestions set primary_suggestion_id = :'first_id' where id = :'second_id';

select case when primary_suggestion_id = :'first_id'::uuid
            then 'PASS: the link is stored'
            else 'FAIL: link missing' end as result
from public.suggestions where id = :'second_id';

select case when count(*) = 2 then 'PASS: both submissions still exist'
            else 'FAIL: only ' || count(*) || ' left' end as result
from public.suggestions where title like 'RLSTEST %';

select case when count(*) = 2 then 'PASS: neither was archived or re-statused'
            else 'FAIL: a status changed' end as result
from public.suggestions where title like 'RLSTEST %' and status = 'new';

select case when count(*) = 2 then 'PASS: both bodies are untouched'
            else 'FAIL: text was altered' end as result
from public.suggestions
where title like 'RLSTEST %'
  and description <> ''
  and improvement_reason <> '';

\echo '-- a president deleting a suggestion (expect: permission denied)'
:refused
delete from public.suggestions where id = :'second_id';
:recover

select case when count(*) = 2 then 'PASS: nothing was deleted or merged away'
            else 'FAIL: a suggestion disappeared' end as result
from public.suggestions where title like 'RLSTEST %';

-- ---------------------------------------------------------------------------
-- 6. One relationship is one row
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 6. pair integrity ==='
\echo '-- reversed pair (expect: check constraint suggestion_matches_ordered)'
:refused
insert into public.suggestion_matches (suggestion_id, match_id, score)
values (greatest(:'first_id'::uuid, :'second_id'::uuid),
        least(:'first_id'::uuid, :'second_id'::uuid), 0.9);
:recover

\echo '-- duplicate pair (expect: unique constraint suggestion_matches_pair)'
:refused
insert into public.suggestion_matches (suggestion_id, match_id, score)
values (least(:'first_id'::uuid, :'second_id'::uuid),
        greatest(:'first_id'::uuid, :'second_id'::uuid), 0.5);
:recover

\echo '-- self pair (expect: check constraint suggestion_matches_distinct)'
:refused
insert into public.suggestion_matches (suggestion_id, match_id, score)
values (:'first_id', :'first_id', 0.5);
:recover

\echo '-- filed under itself (expect: check constraint suggestions_primary_not_self)'
:refused
update public.suggestions set primary_suggestion_id = id where id = :'first_id';
:recover

reset role;
rollback;
