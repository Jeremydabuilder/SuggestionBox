-- ============================================================================
-- Verify the migrations landed correctly
-- ============================================================================
-- Read-only. Inserts nothing, changes nothing. Safe to run any time, on any
-- environment, including production.
--
--   supabase/tests/verify_schema.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The seven public tables
-- ---------------------------------------------------------------------------
select
  expected.tablename,
  case when t.tablename is null then 'MISSING' else 'ok' end as present
from (values
  ('authorized_presidents'),
  ('digest_runs'),
  ('internal_notes'),
  ('status_history'),
  ('submission_log'),
  ('suggestion_matches'),
  ('suggestions')
) as expected(tablename)
left join pg_tables t
  on t.schemaname = 'public' and t.tablename = expected.tablename
order by expected.tablename;

-- A single line you can read at a glance.
select
  case when count(*) = 7 then 'PASS: all 7 expected tables exist'
       else 'FAIL: found ' || count(*) || ' of 7' end as tables_result
from pg_tables
where schemaname = 'public'
  and tablename in (
    'authorized_presidents','digest_runs','internal_notes','status_history',
    'submission_log','suggestion_matches','suggestions'
  );

-- Anything in public we did NOT expect.
select tablename as unexpected_table
from pg_tables
where schemaname = 'public'
  and tablename not in (
    'authorized_presidents','digest_runs','internal_notes','status_history',
    'submission_log','suggestion_matches','suggestions'
  );

-- ---------------------------------------------------------------------------
-- 2. Row Level Security is enabled on every one of them
-- ---------------------------------------------------------------------------
select
  c.relname as tablename,
  c.relrowsecurity as rls_enabled,
  count(p.polname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;

select
  case when count(*) filter (where not c.relrowsecurity) = 0
       then 'PASS: RLS enabled on all ' || count(*) || ' public tables'
       else 'FAIL: RLS OFF on ' || string_agg(c.relname, ', ') filter (where not c.relrowsecurity)
  end as rls_result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- ---------------------------------------------------------------------------
-- 3. Students can insert a suggestion and do nothing else
-- ---------------------------------------------------------------------------
select
  case when count(*) = 1 and bool_and(privilege_type = 'INSERT')
       then 'PASS: anon holds INSERT on suggestions and nothing more'
       else 'FAIL: anon holds ' || coalesce(string_agg(privilege_type, ','), 'nothing') end
  as anon_suggestions_result
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name = 'suggestions';

select
  case when count(*) = 0
       then 'PASS: anon holds no privileges on any other table'
       else 'FAIL: anon can reach ' || string_agg(distinct table_name, ', ') end
  as anon_other_tables_result
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name <> 'suggestions';

-- ---------------------------------------------------------------------------
-- 4. The roster gate the RLS policies depend on
-- ---------------------------------------------------------------------------
select
  case when count(*) = 1 then 'PASS: is_president() exists'
       else 'FAIL: is_president() is missing' end as helper_result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_president';

-- ---------------------------------------------------------------------------
-- 5. The box is empty (this file never adds data)
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.suggestions)            as suggestions,
  (select count(*) from public.authorized_presidents)  as co_presidents,
  (select count(*) from public.suggestion_matches)     as duplicate_matches;
