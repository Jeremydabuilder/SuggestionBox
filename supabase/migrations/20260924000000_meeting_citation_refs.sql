-- ============================================================================
-- Meeting brief citations: keep the S### label alongside the real id
-- ============================================================================
-- The S### references inside a saved brief's agenda/quickWins/etc JSON are
-- only meaningful together with a ref -> suggestion id map. That map existed
-- only in memory during generation (anonymizeSuggestions() reassigns S001..
-- on every run), so without storing it, a REOPENED brief would have no way
-- to turn its own embedded "S003" labels back into a real suggestion to
-- show a title for.
--
-- This adds one nullable column to the citation table from
-- 20260922000000_ai_workspace.sql — which has not been applied to any live
-- project yet — rather than editing that file, per migration discipline.
--
-- Run this in the Supabase SQL editor (after 20260922000000_ai_workspace.sql),
-- or with `supabase db push`. Idempotent: safe to re-run.
-- ============================================================================

alter table public.meeting_brief_citations
  add column if not exists ref text check (ref is null or ref ~ '^S[0-9]{3}$');

comment on column public.meeting_brief_citations.ref is
  'The S### label this suggestion had inside the brief''s content JSON at save time. Stable once saved — not recomputed on reopen.';
