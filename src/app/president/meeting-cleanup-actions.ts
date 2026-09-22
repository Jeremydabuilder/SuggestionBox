"use server";

import { getPresidentSession } from "@/lib/auth";
import { categorizeTranscript } from "./chat-cleanup-review";
import { AUDIO_LIMITS } from "@/lib/audio-limits";
import type { ActionResult } from "./actions";
import type { CleanupSegment } from "@/lib/transcript-cleanup";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export interface CleanupReviewActionResult {
  segments: CleanupSegment[];
  warning: string | null;
}

/**
 * Categorizes a transcript the president already has in front of them
 * (recorded, uploaded, or pasted) into the 7 fixed Cleanup Review
 * categories. Nothing here is saved — the transcript and its segments
 * exist only in this response and whatever the browser holds in memory
 * afterward. Turning a segment into a real decision or action item still
 * requires opening the existing Decision Log / Action Items form and
 * clicking Save, exactly as it always has.
 */
export async function reviewMeetingTranscript(rawTranscript: unknown): Promise<ActionResult<CleanupReviewActionResult>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  if (typeof rawTranscript !== "string" || !rawTranscript.trim()) {
    return fail("Record, upload, or paste a transcript first.");
  }

  const bounded = rawTranscript.trim().slice(0, AUDIO_LIMITS.maxTranscriptChars);
  const result = await categorizeTranscript(session, bounded);

  return { ok: true, data: { segments: result.segments, warning: result.warning } };
}
