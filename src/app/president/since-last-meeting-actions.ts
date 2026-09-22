"use server";

import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildSinceLastMeetingReport,
  formatSinceLastMeetingSummary,
  type SinceLastMeetingReport,
} from "@/lib/since-last-meeting";
import type { ActionResult } from "./actions";
import type { Suggestion, StatusHistoryEntry } from "@/lib/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same read cap the rest of the workspace uses for a single listing query. */
const MAX_ROWS = 500;

export interface SinceLastMeetingResult {
  report: SinceLastMeetingReport;
  meetingHeadline: string | null;
  meetingId: string | null;
  summary: string;
}

interface MeetingBriefRow {
  id: string;
  headline: string;
  created_at: string;
}

interface DecisionRow {
  id: string;
  decision_text: string;
  created_at: string;
}

interface ActionRow {
  id: string;
  action_text: string;
  deadline: string | null;
  completed: boolean;
  created_at: string;
}

/**
 * The Stage 6 read-only report. `rawMeetingId` lets the president ask
 * "since <a specific earlier meeting>"; omitted, it uses the most recent
 * non-archived saved meeting. Every row this reads comes back through the
 * same RLS-scoped session client every other workspace action uses —
 * nothing here needs, or touches, the service-role client.
 */
export async function getSinceLastMeetingReport(rawMeetingId?: unknown): Promise<ActionResult<SinceLastMeetingResult>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const meetingId = typeof rawMeetingId === "string" && UUID_RE.test(rawMeetingId) ? rawMeetingId : null;
  const supabase = await createSupabaseServerClient();

  let referenceTimestamp: string | null = null;
  let meetingHeadline: string | null = null;
  let resolvedMeetingId: string | null = null;

  if (meetingId) {
    const { data, error } = await supabase
      .from("meeting_briefs")
      .select("id, headline, created_at")
      .eq("id", meetingId)
      .maybeSingle();
    if (error) return fail("That meeting could not be loaded. Try again in a moment.");
    if (!data) return fail("That meeting could not be found.");
    const brief = data as MeetingBriefRow;
    referenceTimestamp = brief.created_at;
    meetingHeadline = brief.headline;
    resolvedMeetingId = brief.id;
  } else {
    const { data, error } = await supabase
      .from("meeting_briefs")
      .select("id, headline, created_at")
      .neq("state", "archived")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return fail("Meeting history could not be checked. Try again in a moment.");
    if (data) {
      const brief = data as MeetingBriefRow;
      referenceTimestamp = brief.created_at;
      meetingHeadline = brief.headline;
      resolvedMeetingId = brief.id;
    }
  }

  const [suggestionsRes, statusHistoryRes, decisionsRes, actionsRes] = await Promise.all([
    supabase.from("suggestions").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(MAX_ROWS),
    supabase
      .from("status_history")
      .select("id, suggestion_id, from_status, to_status, changed_by, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
    supabase.from("meeting_decisions").select("id, decision_text, created_at").order("created_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("meeting_actions").select("id, action_text, deadline, completed, created_at").order("created_at", { ascending: false }).limit(MAX_ROWS),
  ]);
  if (suggestionsRes.error || statusHistoryRes.error || decisionsRes.error || actionsRes.error) {
    console.error(
      "[since-last-meeting] load failed:",
      suggestionsRes.error?.message ?? statusHistoryRes.error?.message ?? decisionsRes.error?.message ?? actionsRes.error?.message,
    );
    return fail("The workspace data could not be loaded. Try again in a moment.");
  }

  const suggestions = (suggestionsRes.data ?? []) as Suggestion[];
  const titleById = new Map(suggestions.map((s) => [s.id, s.title]));
  const decisions = (decisionsRes.data ?? []) as DecisionRow[];
  const actions = (actionsRes.data ?? []) as ActionRow[];

  const report = buildSinceLastMeetingReport(referenceTimestamp, new Date(), {
    suggestions,
    statusHistory: (statusHistoryRes.data ?? []) as StatusHistoryEntry[],
    suggestionTitleById: titleById,
    decisions: decisions.map((d) => ({ id: d.id, decisionText: d.decision_text, createdAt: d.created_at })),
    actions: actions.map((a) => ({ id: a.id, actionText: a.action_text, createdAt: a.created_at, completed: a.completed, deadline: a.deadline })),
  });

  return {
    ok: true,
    data: {
      report,
      meetingHeadline,
      meetingId: resolvedMeetingId,
      summary: formatSinceLastMeetingSummary(report, meetingHeadline),
    },
  };
}
