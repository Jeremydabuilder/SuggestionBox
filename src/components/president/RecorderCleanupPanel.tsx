"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "@/app/president/meeting-transcription-actions";
import { reviewMeetingTranscript } from "@/app/president/meeting-cleanup-actions";
import { AUDIO_LIMITS, validateAudioFile } from "@/lib/audio-limits";
import { CLEANUP_CATEGORY_LABELS, CLEANUP_HIDDEN_BY_DEFAULT, type CleanupSegment } from "@/lib/transcript-cleanup";
import type { PrefillDecision } from "./DecisionLog";
import type { PrefillAction } from "./ActionItems";

type Stage = "consent" | "recording" | "have-audio" | "transcribing" | "cleanup";

/**
 * Record (or upload, or paste) a meeting transcript, then review it in
 * the 7 fixed Cleanup Review categories. Nothing here saves anything:
 * audio never leaves this component except as one in-memory upload to
 * transcribeAudio, which itself never writes it to disk (see that
 * file's own doc comment); the transcript and its categorized segments
 * live only in this component's React state — closing this panel, or
 * navigating away, discards all of it. Turning a segment into a real
 * decision or action item hands off to the existing, already-secured
 * Decision Log / Action Items forms (via onAddDecision/onAddAction,
 * the same prefill handoff Stage 5 already wired up) — this component
 * never calls a mutation itself.
 */
export default function RecorderCleanupPanel({
  onAddDecision,
  onAddAction,
  onClose,
}: {
  onAddDecision: (prefill: PrefillDecision) => void;
  onAddAction: (prefill: PrefillAction) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("consent");
  const [micError, setMicError] = useState<string | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [segments, setSegments] = useState<CleanupSegment[] | null>(null);
  const [cleanupWarning, setCleanupWarning] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopTracks, [stopTracks]);

  async function startRecording() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        setAudioBlob(blob);
        setStage("have-audio");
        stopTracks();
      };
      recorder.start();
      startedAtRef.current = Date.now();
      setRecordingMs(0);
      setStage("recording");
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setRecordingMs(elapsed);
        if (elapsed >= AUDIO_LIMITS.maxRecordingMs) stopRecording();
      }, 250);
    } catch {
      setMicError("Microphone access was denied or isn't available. Paste a transcript or upload an audio file instead.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function discardAudio() {
    setAudioBlob(null);
    setStage("consent");
  }

  function handleFileUpload(file: File) {
    const check = validateAudioFile({ size: file.size, type: file.type });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    setAudioBlob(file);
    setStage("have-audio");
  }

  async function doTranscribe() {
    if (!audioBlob) return;
    setBusy(true);
    setError(null);
    setStage("transcribing");
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    const result = await transcribeAudio(formData);
    setAudioBlob(null); // discard the in-memory blob the moment the request completes, success or not
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setStage("have-audio");
      return;
    }
    setTranscript(result.data.transcript);
    await runCleanup(result.data.transcript);
  }

  async function submitPastedText() {
    if (!pastedText.trim()) {
      setError("Paste some transcript text first.");
      return;
    }
    setError(null);
    setTranscript(pastedText.trim());
    await runCleanup(pastedText.trim());
  }

  async function runCleanup(text: string) {
    setBusy(true);
    setError(null);
    const result = await reviewMeetingTranscript(text);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSegments(result.data.segments);
    setCleanupWarning(result.data.warning);
    setStage("cleanup");
  }

  function sendToDecisions(segment: CleanupSegment) {
    onAddDecision({ text: segment.text, meetingId: null, citedSuggestionIds: [] });
  }

  function sendToActions(segment: CleanupSegment) {
    onAddAction({ text: segment.text, meetingId: null, citedSuggestionIds: [] });
  }

  const visibleSegments = (segments ?? []).filter((s) => showHidden || !CLEANUP_HIDDEN_BY_DEFAULT.has(s.category));
  const hiddenCount = (segments ?? []).filter((s) => CLEANUP_HIDDEN_BY_DEFAULT.has(s.category)).length;

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-navy-soft">
        Record, upload, or paste a meeting transcript. Nothing is saved anywhere until you review it below and explicitly
        add a specific item to the Decision Log or Action Items.
      </p>

      {stage === "consent" && (
        <div className="space-y-3 rounded-[12px] border border-rule bg-paper-deep/40 p-4">
          <p className="text-[13px] text-navy">
            Recording starts only when you click Start, uses your browser&rsquo;s microphone, and is never saved as
            audio — it is sent once for transcription and then discarded.
          </p>
          {micError && <p role="alert" className="text-[12.5px] font-medium text-rose-800">{micError}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={startRecording} className="btn-primary py-2 text-[13px]">
              Start recording
            </button>
            <label className="btn-quiet cursor-pointer py-2 text-[13px]">
              Upload audio file
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
            </label>
          </div>
          <div>
            <label htmlFor="paste-transcript" className="text-[12.5px] font-semibold text-navy">
              Or paste a transcript directly
            </label>
            <textarea
              id="paste-transcript"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={4}
              maxLength={AUDIO_LIMITS.maxTranscriptChars}
              className="field mt-1.5 resize-y text-[13px]"
              placeholder="Paste meeting notes or a transcript here…"
            />
            <button type="button" onClick={() => void submitPastedText()} disabled={busy} className="btn-quiet mt-2 py-2 text-[13px]">
              {busy ? "Processing…" : "Review pasted text"}
            </button>
          </div>
        </div>
      )}

      {stage === "recording" && (
        <div className="flex items-center gap-3 rounded-[12px] border border-rose-300 bg-rose-50 p-4">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" aria-hidden />
          <p className="flex-1 text-[13px] font-medium text-rose-900">
            Recording… {Math.floor(recordingMs / 1000)}s / {Math.floor(AUDIO_LIMITS.maxRecordingMs / 1000)}s max
          </p>
          <button type="button" onClick={stopRecording} className="btn-primary py-2 text-[13px]">
            Stop
          </button>
        </div>
      )}

      {stage === "have-audio" && audioBlob && (
        <div className="space-y-2 rounded-[12px] border border-rule bg-paper-deep/40 p-4">
          <p className="text-[13px] text-navy">Recording ready ({Math.round(audioBlob.size / 1024)}KB). Transcribe it, or discard and try again.</p>
          {error && <p role="alert" className="text-[12.5px] font-medium text-rose-800">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={discardAudio} className="btn-quiet py-2 text-[13px]">Discard</button>
            <button type="button" onClick={() => void doTranscribe()} disabled={busy} className="btn-primary py-2 text-[13px]">
              {busy ? "Transcribing…" : "Transcribe"}
            </button>
          </div>
        </div>
      )}

      {stage === "transcribing" && (
        <div className="flex items-center gap-2 rounded-[12px] border border-rule bg-paper-deep/40 p-4 text-[13px] text-navy-soft">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-navy-soft/30 border-t-navy-soft" aria-hidden />
          Transcribing…
        </div>
      )}

      {stage === "cleanup" && segments && (
        <div className="space-y-3">
          {transcript && (
            <details className="rounded-[12px] border border-rule bg-paper-deep/30 p-3">
              <summary className="cursor-pointer text-[12.5px] font-semibold text-navy">Full transcript</summary>
              <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-navy-soft">{transcript}</p>
            </details>
          )}
          {cleanupWarning && <p className="text-[12.5px] font-medium text-amber-800">{cleanupWarning}</p>}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setShowHidden((v) => !v)} className="text-[12px] font-semibold text-navy-soft underline">
              {showHidden ? "Hide" : `Show ${hiddenCount} hidden (off-topic/sensitive)`}
            </button>
          )}
          <ul className="space-y-2">
            {visibleSegments.map((segment) => (
              <li key={segment.index} className="rounded-xl border border-rule bg-paper px-3.5 py-3">
                <span className="mb-1 inline-block rounded-full border border-rule bg-white px-2 py-0.5 text-[10.5px] font-semibold text-navy-soft">
                  {CLEANUP_CATEGORY_LABELS[segment.category]}
                </span>
                <p className="text-[13px] leading-relaxed text-navy">{segment.text}</p>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" onClick={() => sendToDecisions(segment)} className="btn-quiet px-2.5 py-1.5 text-[11.5px]">
                    Add to Decision Log
                  </button>
                  <button type="button" onClick={() => sendToActions(segment)} className="btn-quiet px-2.5 py-1.5 text-[11.5px]">
                    Add to Action Items
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end border-t border-rule pt-3">
        <button type="button" onClick={onClose} className="btn-quiet">
          Close
        </button>
      </div>
    </div>
  );
}
