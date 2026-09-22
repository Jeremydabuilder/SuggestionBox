"use server";

import { getPresidentSession } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { validateAudioFile } from "@/lib/audio-limits";
import { transcribeAudioBuffer } from "@/lib/groq";
import { AUDIO_LIMITS } from "@/lib/audio-limits";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const TRANSCRIPTION_ERROR_MESSAGES: Record<string, string> = {
  model_unavailable: "Transcription isn't available right now — Groq hasn't published a speech-to-text model on this account. Paste the transcript text instead.",
  rate_limited: "The free AI limit is busy right now. Wait a moment and try again.",
  unauthorized: "The private Groq key is missing or invalid.",
  upstream_error: "Transcription failed. Try again in a moment.",
  timeout: "Transcription took too long. Try a shorter recording.",
  network_error: "Transcription could not reach the AI service. Try again in a moment.",
};

export interface TranscribeAudioResult {
  transcript: string;
}

/**
 * Everything here happens in memory. `formData` is read directly into a
 * Buffer, sent to Groq, and the Buffer becomes eligible for garbage
 * collection the moment this function returns — nothing is written to
 * disk, nothing is written to Supabase, and no audio bytes exist anywhere
 * outside this one request after it completes. The returned transcript
 * itself is not saved either: it lives only in the browser's component
 * state until the president explicitly saves something built from it
 * (a decision, an action item) through the existing, already-secured
 * create forms.
 */
export async function transcribeAudio(formData: FormData): Promise<ActionResult<TranscribeAudioResult>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  if (!serverEnv.groqApiKey) {
    return fail("Transcription isn't set up yet — set GROQ_API_KEY, or paste the transcript text instead.");
  }

  const file = formData.get("audio");
  if (!(file instanceof File)) return fail("No audio file was received.");

  const check = validateAudioFile({ size: file.size, type: file.type });
  if (!check.ok) return fail(check.error);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return fail("That recording could not be read. Try again.");
  }

  const outcome = await transcribeAudioBuffer(buffer, file.name || "recording.webm", file.type || "audio/webm");
  // `buffer` is not referenced again below — nothing here retains it.

  if (!outcome.ok) {
    return fail(TRANSCRIPTION_ERROR_MESSAGES[outcome.errorCategory] ?? "Transcription failed. Try again in a moment.");
  }

  return { ok: true, data: { transcript: outcome.text.slice(0, AUDIO_LIMITS.maxTranscriptChars) } };
}
