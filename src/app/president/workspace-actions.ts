"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";
import {
  saveMeetingBriefInputSchema,
  updateMeetingBriefInputSchema,
  resolveCitations,
  type CitationSource,
  type MeetingBriefContent,
  type MeetingBriefSummary,
  type SavedMeetingBrief,
} from "@/lib/meeting-brief-store";
import type { Suggestion } from "@/lib/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Raw row shape as it comes back from `meeting_briefs`. */
interface MeetingBriefRow {
  id: string;
  headline: string;
  executive_summary: string;
  scope: "new" | "active" | "all" | null;
  state: "draft" | "saved" | "archived";
  agenda: MeetingBriefContent["agenda"];
  quick_wins: MeetingBriefContent["quickWins"];
  decisions_needed: MeetingBriefContent["decisionsNeeded"];
  follow_ups: MeetingBriefContent["followUps"];
  watchouts: MeetingBriefContent["watchouts"];
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  archived_at: string | null;
}

function mapBriefRow(row: MeetingBriefRow): Omit<SavedMeetingBrief, "citations"> {
  return {
    id: row.id,
    headline: row.headline,
    executiveSummary: row.executive_summary,
    scope: row.scope,
    state: row.state,
    agenda: row.agenda ?? [],
    quickWins: row.quick_wins ?? [],
    decisionsNeeded: row.decisions_needed ?? [],
    followUps: row.follow_ups ?? [],
    watchouts: row.watchouts ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

/**
 * The only place a citation is trusted. `sources` is whatever the client
 * sent (a generated brief's ref -> id map); `existingSuggestionIds` is a
 * fresh, RLS-scoped read of which of those ids are real. Anything else is
 * dropped before it ever reaches the database.
 */
async function resolveCitationsForSave(
  supabase: SupabaseServerClient,
  content: MeetingBriefContent,
  sources: Array<{ ref: string; id: string }>,
) {
  const candidateIds = [...new Set(sources.map((source) => source.id))];
  if (candidateIds.length === 0) return resolveCitations(content, sources, new Set());

  const { data, error } = await supabase.from("suggestions").select("id").in("id", candidateIds);
  if (error) throw new Error(error.message);

  const existing = new Set((data ?? []).map((row: { id: string }) => row.id));
  return resolveCitations(content, sources, existing);
}

/** Look up titles/statuses for a resolved set of citations, from the database — never from client input. */
async function loadCitationSources(
  supabase: SupabaseServerClient,
  citations: Array<{ ref: string; suggestionId: string }>,
): Promise<CitationSource[]> {
  if (citations.length === 0) return [];
  const ids = citations.map((c) => c.suggestionId);
  const { data, error } = await supabase
    .from("suggestions")
    .select("id, title, status")
    .in("id", ids);
  if (error) throw new Error(error.message);

  const byId = new Map((data ?? []).map((row: { id: string; title: string; status: Suggestion["status"] }) => [row.id, row]));
  const out: CitationSource[] = [];
  for (const citation of citations) {
    const suggestion = byId.get(citation.suggestionId);
    if (!suggestion) continue; // Deleted between resolve and read-back — skip rather than show a broken chip.
    out.push({ ref: citation.ref, id: citation.suggestionId, title: suggestion.title, status: suggestion.status });
  }
  return out;
}

async function writeCitations(
  supabase: SupabaseServerClient,
  briefId: string,
  citations: Array<{ ref: string; suggestionId: string }>,
) {
  if (citations.length === 0) return { error: null as string | null };
  const { error } = await supabase.from("meeting_brief_citations").insert(
    citations.map((c) => ({ brief_id: briefId, suggestion_id: c.suggestionId, ref: c.ref })),
  );
  return { error: error?.message ?? null };
}

/* ------------------------------------------------------------------ */
/* Save — the one place AI-generated content becomes a database row.   */
/* Nothing here is ever called except in direct response to a          */
/* president clicking Save; generation itself never calls this.        */
/* ------------------------------------------------------------------ */

export async function saveMeetingBrief(rawInput: unknown): Promise<ActionResult<SavedMeetingBrief>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const parsed = saveMeetingBriefInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("That brief couldn't be saved — some fields didn't pass validation.");
  const { content, scope, sources, isDraft } = parsed.data;

  const supabase = await createSupabaseServerClient();

  let resolved;
  try {
    resolved = await resolveCitationsForSave(supabase, content, sources);
  } catch {
    return fail("The inbox could not be checked. Try again in a moment.");
  }

  const { data, error } = await supabase
    .from("meeting_briefs")
    .insert({
      headline: resolved.content.headline,
      executive_summary: resolved.content.executiveSummary,
      scope,
      state: isDraft ? "draft" : "saved",
      agenda: resolved.content.agenda,
      quick_wins: resolved.content.quickWins,
      decisions_needed: resolved.content.decisionsNeeded,
      follow_ups: resolved.content.followUps,
      watchouts: resolved.content.watchouts,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("[workspace] meeting brief insert failed:", error?.message);
    return fail("That meeting couldn't be saved. Try again in a moment.");
  }

  const { error: citationError } = await writeCitations(supabase, data.id, resolved.citations);
  if (citationError) {
    // A brief with silently-missing citations misrepresents what was
    // approved. Roll it back rather than leave a partial record.
    await supabase.from("meeting_briefs").delete().eq("id", data.id);
    console.error("[workspace] citation insert failed:", citationError);
    return fail("The meeting couldn't be saved. Try again in a moment.");
  }

  let citations: CitationSource[] = [];
  try {
    citations = await loadCitationSources(supabase, resolved.citations);
  } catch {
    // The brief itself is saved correctly; citation display can recover on next load.
  }

  revalidatePath("/president");
  return { ok: true, data: { ...mapBriefRow(data as MeetingBriefRow), citations } };
}

/* ------------------------------------------------------------------ */
/* Update — editing a saved brief (draft or saved). Archived briefs    */
/* must be restored first.                                             */
/* ------------------------------------------------------------------ */

export async function updateMeetingBrief(rawInput: unknown): Promise<ActionResult<SavedMeetingBrief>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const parsed = updateMeetingBriefInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("That meeting couldn't be updated — some fields didn't pass validation.");
  const { id, content, scope, sources, isDraft } = parsed.data;

  const supabase = await createSupabaseServerClient();

  const { data: current, error: currentError } = await supabase
    .from("meeting_briefs")
    .select("state")
    .eq("id", id)
    .single();
  if (currentError || !current) return fail("That meeting could not be found.");
  if (current.state === "archived") return fail("Restore this meeting before editing it.");

  let resolved;
  try {
    resolved = await resolveCitationsForSave(supabase, content, sources);
  } catch {
    return fail("The inbox could not be checked. Try again in a moment.");
  }

  const { data, error } = await supabase
    .from("meeting_briefs")
    .update({
      headline: resolved.content.headline,
      executive_summary: resolved.content.executiveSummary,
      scope,
      state: isDraft ? "draft" : "saved",
      agenda: resolved.content.agenda,
      quick_wins: resolved.content.quickWins,
      decisions_needed: resolved.content.decisionsNeeded,
      follow_ups: resolved.content.followUps,
      watchouts: resolved.content.watchouts,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    console.error("[workspace] meeting brief update failed:", error?.message);
    return fail("That meeting couldn't be updated. Try again in a moment.");
  }

  // Replace citations wholesale: simplest way to guarantee the saved set
  // exactly matches what is now approved, with no leftover stale rows.
  const { error: deleteError } = await supabase.from("meeting_brief_citations").delete().eq("brief_id", id);
  if (deleteError) {
    console.error("[workspace] citation replace (delete) failed:", deleteError.message);
    return fail("That meeting couldn't be updated. Try again in a moment.");
  }
  const { error: citationError } = await writeCitations(supabase, id, resolved.citations);
  if (citationError) {
    console.error("[workspace] citation replace (insert) failed:", citationError);
    return fail("That meeting couldn't be updated. Try again in a moment.");
  }

  let citations: CitationSource[] = [];
  try {
    citations = await loadCitationSources(supabase, resolved.citations);
  } catch {
    // Non-fatal — see saveMeetingBrief.
  }

  revalidatePath("/president");
  return { ok: true, data: { ...mapBriefRow(data as MeetingBriefRow), citations } };
}

/* ------------------------------------------------------------------ */
/* Meeting History — list, open, archive, restore.                     */
/* ------------------------------------------------------------------ */

export async function listMeetingBriefs(
  includeArchived: boolean,
): Promise<ActionResult<MeetingBriefSummary[]>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("meeting_briefs")
    .select("id, headline, executive_summary, state, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!includeArchived) query = query.neq("state", "archived");

  const { data, error } = await query;
  if (error) return fail("The meeting history could not be loaded. Try again in a moment.");

  const briefs = (data ?? []) as Array<Pick<MeetingBriefRow, "id" | "headline" | "executive_summary" | "state" | "created_at" | "updated_at">>;
  if (briefs.length === 0) return { ok: true, data: [] };

  const { data: citationRows, error: citationError } = await supabase
    .from("meeting_brief_citations")
    .select("brief_id")
    .in("brief_id", briefs.map((b) => b.id));
  if (citationError) return fail("The meeting history could not be loaded. Try again in a moment.");

  const counts = new Map<string, number>();
  for (const row of (citationRows ?? []) as Array<{ brief_id: string }>) {
    counts.set(row.brief_id, (counts.get(row.brief_id) ?? 0) + 1);
  }

  return {
    ok: true,
    data: briefs.map((brief) => ({
      id: brief.id,
      headline: brief.headline,
      executiveSummary: brief.executive_summary,
      state: brief.state,
      createdAt: brief.created_at,
      updatedAt: brief.updated_at,
      citationCount: counts.get(brief.id) ?? 0,
    })),
  };
}

export async function getMeetingBrief(id: string): Promise<ActionResult<SavedMeetingBrief>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Unknown meeting.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("meeting_briefs").select("*").eq("id", id).single();
  if (error || !data) return fail("That meeting could not be found.");

  const { data: citationRows, error: citationError } = await supabase
    .from("meeting_brief_citations")
    .select("ref, suggestion_id")
    .eq("brief_id", id);
  if (citationError) return fail("That meeting could not be loaded. Try again in a moment.");

  const pairs = ((citationRows ?? []) as Array<{ ref: string | null; suggestion_id: string }>)
    .filter((row): row is { ref: string; suggestion_id: string } => Boolean(row.ref))
    .map((row) => ({ ref: row.ref, suggestionId: row.suggestion_id }));

  let citations: CitationSource[] = [];
  try {
    citations = await loadCitationSources(supabase, pairs);
  } catch {
    return fail("That meeting could not be loaded. Try again in a moment.");
  }

  return { ok: true, data: { ...mapBriefRow(data as MeetingBriefRow), citations } };
}

async function setMeetingBriefState(
  id: string,
  state: "saved" | "archived",
): Promise<ActionResult<{ state: "saved" | "archived" }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Unknown meeting.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("meeting_briefs")
    .update({ state })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) return fail("That meeting could not be updated. Try again in a moment.");
  revalidatePath("/president");
  return { ok: true, data: { state } };
}

/** Archiving never deletes anything — the brief, its decisions, and its actions all remain, just out of the active list. */
export async function archiveMeetingBrief(id: string): Promise<ActionResult<{ state: "archived" }>> {
  const result = await setMeetingBriefState(id, "archived");
  if (!result.ok) return result;
  return { ok: true, data: { state: "archived" } };
}

export async function restoreMeetingBrief(id: string): Promise<ActionResult<{ state: "saved" }>> {
  const result = await setMeetingBriefState(id, "saved");
  if (!result.ok) return result;
  return { ok: true, data: { state: "saved" } };
}
