"use server";

import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AGENT_HOME_STALE_DAYS, type AgentHomeBriefing } from "@/lib/agent-home-briefing";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * The deterministic briefing shown when a conversation opens with no
 * messages yet. Every number here is a plain count query through the
 * same RLS-scoped session client every other workspace read uses —
 * zero Groq calls, same as every other read-only tool in this app.
 * Called once when the chat pane first shows the empty state, never on
 * an interval and never in the background.
 */
export async function getAgentHomeBriefing(): Promise<ActionResult<AgentHomeBriefing>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const staleCutoff = new Date(Date.now() - AGENT_HOME_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const [unreadRes, duplicateRes, actionsRes, staleRes, meetingRes] = await Promise.all([
    supabase.from("suggestions").select("id", { count: "exact", head: true }).eq("is_read", false),
    supabase.from("suggestion_matches").select("id", { count: "exact", head: true }).eq("state", "suggested"),
    supabase.from("meeting_actions").select("id, deadline, completed").eq("completed", false),
    supabase
      .from("suggestions")
      .select("id", { count: "exact", head: true })
      .eq("status", "new")
      .lt("created_at", staleCutoff),
    supabase
      .from("meeting_briefs")
      .select("headline, created_at")
      .neq("state", "archived")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (unreadRes.error || duplicateRes.error || actionsRes.error || staleRes.error || meetingRes.error) {
    return fail("The briefing could not be loaded. Try again in a moment.");
  }

  const openActions = (actionsRes.data ?? []) as Array<{ id: string; deadline: string | null; completed: boolean }>;
  const overdueActionCount = openActions.filter((a) => a.deadline !== null && a.deadline < nowIso).length;
  const meeting = meetingRes.data as { headline: string; created_at: string } | null;

  return {
    ok: true,
    data: {
      unreadCount: unreadRes.count ?? 0,
      duplicateReviewCount: duplicateRes.count ?? 0,
      openActionCount: openActions.length,
      overdueActionCount,
      staleSuggestionCount: staleRes.count ?? 0,
      mostRecentMeeting: meeting ? { headline: meeting.headline, createdAt: meeting.created_at } : null,
    },
  };
}
