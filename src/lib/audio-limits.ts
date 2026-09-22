/**
 * Pure bounds and validation for the Stage 9 recorder/upload path. No
 * I/O, no Groq — just the hard limits that keep an audio upload small,
 * short, and a recognized format before anything is sent anywhere.
 */

export const AUDIO_LIMITS = {
  /** Hard client-side recording cap — MediaRecorder is told to auto-stop at this point. */
  maxRecordingMs: 15 * 60_000,
  /** Matches Groq's own practical upload ceiling for audio transcription. */
  maxUploadBytes: 25 * 1024 * 1024,
  /** Also enforced server-side, never trusted from the client alone. */
  maxTranscriptChars: 20_000,
} as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
] as const;

export interface AudioFileCheck {
  size: number;
  type: string;
}

export function validateAudioFile(file: AudioFileCheck): { ok: true } | { ok: false; error: string } {
  if (file.size <= 0) return { ok: false, error: "That recording is empty." };
  if (file.size > AUDIO_LIMITS.maxUploadBytes) {
    return { ok: false, error: `That recording is too large (max ${Math.floor(AUDIO_LIMITS.maxUploadBytes / (1024 * 1024))}MB).` };
  }
  const normalizedType = file.type.split(";")[0]!.trim().toLowerCase();
  if (!(ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(normalizedType)) {
    return { ok: false, error: "That file doesn't look like a supported audio format." };
  }
  return { ok: true };
}
