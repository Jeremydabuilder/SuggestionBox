"use server";

import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildPromiseTracker, type PromiseTrackerReport } from "@/lib/promise-tracker";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const MAX_ROWS = 500;

interface DecisionRow {
  id: string;
  decision_text: string;
  meeting_id: string | null;
  created_at: string;
}

interface ActionRow {
  id: string;
  action_text: string;
  meeting_id: string | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

interface SuggestionRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

/**
 * Deterministic follow-through gap detection — no Groq call anywhere.
 * Three independent, factual gap types (see lib/promise-tracker.ts):
 * a meeting-scoped decision with no action recorded for that meeting;
 * an approved suggestion with zero linked action items
 * (meeting_action_citations); an open action nobody has updated since
 * it was created. Every number comes straight from the database — the
 * database can still be incomplete (a decision made verbally and never
 * logged), which is exactly why the wording stays cautious everywhere
 * this report is shown.
 */
export async function getPromiseTracker(): Promise<ActionResult<PromiseTrackerReport>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const [decisionsRes, actionsRes, suggestionsRes, actionCitationsRes] = await Promise.all([
    supabase.from("meeting_decisions").select("id, decision_text, meeting_id, created_at").order("created_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("meeting_actions").select("id, action_text, meeting_id, completed, created_at, updated_at").limit(MAX_ROWS),
    supabase.from("suggestions").select("id, title, status, created_at").eq("status", "approved").limit(MAX_ROWS),
    supabase.from("meeting_action_citations").select("suggestion_id").limit(MAX_ROWS * 4),
  ]);
  if (decisionsRes.error || actionsRes.error || suggestionsRes.error || actionCitationsRes.error) {
    return fail("Follow-ups could not be checked. Try again in a moment.");
  }

  const decisions = (decisionsRes.data ?? []) as DecisionRow[];
  const meetingIds = decisions.map((d) => d.meeting_id).filter((id): id is string => id !== null);
  let headlineById = new Map<string, string>();
  if (meetingIds.length > 0) {
    const { data: meetings, error: meetingsError } = await supabase
      .from("meeting_briefs")
      .select("id, headline")
      .in("id", [...new Set(meetingIds)]);
    if (meetingsError) return fail("Follow-ups could not be checked. Try again in a moment.");
    headlineById = new Map((meetings ?? []).map((m: { id: string; headline: string }) => [m.id, m.headline]));
  }

  const linkedActionCountBySuggestion = new Map<string, number>();
  for (const row of (actionCitationsRes.data ?? []) as Array<{ suggestion_id: string }>) {
    linkedActionCountBySuggestion.set(row.suggestion_id, (linkedActionCountBySuggestion.get(row.suggestion_id) ?? 0) + 1);
  }

  const report = buildPromiseTracker(
    decisions.map((d) => ({
      id: d.id,
      decisionText: d.decision_text,
      meetingId: d.meeting_id,
      meetingHeadline: d.meeting_id ? headlineById.get(d.meeting_id) ?? null : null,
      createdAt: d.created_at,
    })),
    ((actionsRes.data ?? []) as ActionRow[]).map((a) => ({
      id: a.id,
      actionText: a.action_text,
      meetingId: a.meeting_id,
      completed: a.completed,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    })),
    new Date(),
    ((suggestionsRes.data ?? []) as SuggestionRow[]).map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      createdAt: s.created_at,
      linkedActionCount: linkedActionCountBySuggestion.get(s.id) ?? 0,
    })),
  );

  return { ok: true, data: report };
}
