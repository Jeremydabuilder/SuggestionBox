import { z } from "zod";
import { meetingBriefSchema, meetingScopeSchema } from "./meeting-agent.ts";
import type { Suggestion } from "./types.ts";

export const MEETING_STATES = ["draft", "saved", "archived"] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

/**
 * What a president can actually save. This is the generation schema minus
 * `themes` — the meeting_briefs table has no themes column, so a theme
 * insight is useful while reviewing a freshly generated brief but is not
 * part of the saved record. Every other field matches meetingBriefSchema
 * exactly, so anything the model produced (and the president approved)
 * passes straight through.
 */
export const meetingBriefContentSchema = meetingBriefSchema.omit({ themes: true });
export type MeetingBriefContent = z.infer<typeof meetingBriefContentSchema>;

export const saveMeetingBriefInputSchema = z.object({
  content: meetingBriefContentSchema,
  scope: meetingScopeSchema.nullable(),
  /** ref -> real suggestion id, exactly as returned by the generation step. */
  sources: z
    .array(
      z.object({
        ref: z.string().regex(/^S\d{3}$/),
        id: z.string().uuid(),
      }),
    )
    .max(500),
  isDraft: z.boolean().default(false),
});
export type SaveMeetingBriefInput = z.infer<typeof saveMeetingBriefInputSchema>;

export const updateMeetingBriefInputSchema = saveMeetingBriefInputSchema.extend({
  id: z.string().uuid(),
});
export type UpdateMeetingBriefInput = z.infer<typeof updateMeetingBriefInputSchema>;

export interface CitationSource {
  ref: string;
  id: string;
  title: string;
  status: Suggestion["status"];
}

export interface SavedMeetingBrief {
  id: string;
  headline: string;
  executiveSummary: string;
  scope: "new" | "active" | "all" | null;
  state: MeetingState;
  agenda: MeetingBriefContent["agenda"];
  quickWins: MeetingBriefContent["quickWins"];
  decisionsNeeded: MeetingBriefContent["decisionsNeeded"];
  followUps: MeetingBriefContent["followUps"];
  watchouts: MeetingBriefContent["watchouts"];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  archivedAt: string | null;
  citations: CitationSource[];
}

export interface MeetingBriefSummary {
  id: string;
  headline: string;
  executiveSummary: string;
  state: MeetingState;
  createdAt: string;
  updatedAt: string;
  citationCount: number;
}

/**
 * Every S### ref used anywhere in the approved content, deduplicated. Used
 * both to resolve refs to real suggestion ids before saving, and to strip
 * any ref that does not resolve to a suggestion the president can access.
 */
function allRefsIn(content: MeetingBriefContent): Set<string> {
  const refs = new Set<string>();
  for (const item of content.agenda) for (const ref of item.suggestionRefs) refs.add(ref);
  for (const item of content.quickWins) for (const ref of item.suggestionRefs) refs.add(ref);
  for (const item of content.decisionsNeeded) for (const ref of item.suggestionRefs) refs.add(ref);
  for (const item of content.followUps) for (const ref of item.suggestionRefs) refs.add(ref);
  return refs;
}

/**
 * Drop any suggestionRefs not present in `keepRefs`. Never touches text —
 * only the citation lists next to it.
 */
export function stripUnknownRefs(
  content: MeetingBriefContent,
  keepRefs: ReadonlySet<string>,
): MeetingBriefContent {
  const keep = (refs: string[]) => refs.filter((ref) => keepRefs.has(ref));
  return {
    ...content,
    agenda: content.agenda.map((item) => ({ ...item, suggestionRefs: keep(item.suggestionRefs) })),
    quickWins: content.quickWins.map((item) => ({ ...item, suggestionRefs: keep(item.suggestionRefs) })),
    decisionsNeeded: content.decisionsNeeded.map((item) => ({
      ...item,
      suggestionRefs: keep(item.suggestionRefs),
    })),
    followUps: content.followUps.map((item) => ({ ...item, suggestionRefs: keep(item.suggestionRefs) })),
  };
}

export interface ResolvedCitations {
  content: MeetingBriefContent;
  citations: Array<{ ref: string; suggestionId: string }>;
}

/**
 * The one place citation trust decisions get made. `sources` is client-
 * supplied and therefore untrusted — a forged ref->id mapping is exactly
 * what this guards against. `existingSuggestionIds` must come from a real,
 * RLS-scoped database query (see workspace-actions.ts), never from the
 * client.
 *
 * Any ref used in the content but missing from `sources`, or whose mapped
 * id is not in `existingSuggestionIds`, is silently removed from both the
 * content's citation lists and the returned citation rows. Nothing else
 * about the content changes.
 */
export function resolveCitations(
  content: MeetingBriefContent,
  sources: Array<{ ref: string; id: string }>,
  existingSuggestionIds: ReadonlySet<string>,
): ResolvedCitations {
  const usedRefs = allRefsIn(content);
  const refToId = new Map(sources.map((source) => [source.ref, source.id]));

  const validRefs = new Set<string>();
  const citations: Array<{ ref: string; suggestionId: string }> = [];
  const seenIds = new Set<string>();

  for (const ref of usedRefs) {
    const suggestionId = refToId.get(ref);
    if (!suggestionId || !existingSuggestionIds.has(suggestionId)) continue;
    validRefs.add(ref);
    if (!seenIds.has(suggestionId)) {
      seenIds.add(suggestionId);
      citations.push({ ref, suggestionId });
    }
  }

  return { content: stripUnknownRefs(content, validRefs), citations };
}
