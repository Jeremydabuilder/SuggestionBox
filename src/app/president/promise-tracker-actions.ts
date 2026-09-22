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
  meeting_id: string | null;
}

/**
 * Deterministic decision -> action follow-up gap detection — no Groq
 * call. See lib/promise-tracker.ts for the honest limitation: only
 * decisions tied to a meeting can be checked at all, since meetingId is
 * the only structural link this schema has between a decision and a
 * follow-up action.
 */
export async function getPromiseTracker(): Promise<ActionResult<PromiseTrackerReport>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const [decisionsRes, actionsRes] = await Promise.all([
    supabase.from("meeting_decisions").select("id, decision_text, meeting_id, created_at").order("created_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("meeting_actions").select("meeting_id").limit(MAX_ROWS),
  ]);
  if (decisionsRes.error || actionsRes.error) {
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

  const report = buildPromiseTracker(
    decisions.map((d) => ({
      id: d.id,
      decisionText: d.decision_text,
      meetingId: d.meeting_id,
      meetingHeadline: d.meeting_id ? headlineById.get(d.meeting_id) ?? null : null,
      createdAt: d.created_at,
    })),
    ((actionsRes.data ?? []) as ActionRow[]).map((a) => ({ meetingId: a.meeting_id })),
    new Date(),
  );

  return { ok: true, data: report };
}
