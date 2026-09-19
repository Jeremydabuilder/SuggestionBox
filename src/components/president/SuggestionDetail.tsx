"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { motion } from "framer-motion";
import {
  CATEGORY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type InternalNote,
  type StatusHistoryEntry,
  type Status,
  type Suggestion,
} from "@/lib/types";
import { LIMITS } from "@/lib/validation";
import {
  addNote,
  deleteNote,
  loadDetail,
  markRead,
  setStatus,
} from "@/app/president/actions";
import {
  ArchiveIcon,
  CloseIcon,
  CopyButton,
  LocalTime,
  StatusChip,
} from "./ui";

export default function SuggestionDetail({
  suggestion,
  currentEmail,
  onClose,
  refreshSignal,
}: {
  suggestion: Suggestion;
  currentEmail: string;
  onClose: () => void;
  /** Bumped by the panel when realtime reports a change. */
  refreshSignal: number;
}) {
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteBody, setNoteBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [savingNote, setSavingNote] = useState(false);
  const notesEndRef = useRef<HTMLDivElement>(null);

  const suggestionId = suggestion.id;

  const refresh = useCallback(async () => {
    const result = await loadDetail(suggestionId);
    if (result.ok) {
      setNotes(result.data.notes);
      setHistory(result.data.history);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [suggestionId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh, refreshSignal]);

  // Opening a suggestion marks it read — that is what "read" means here.
  useEffect(() => {
    if (!suggestion.is_read) {
      startTransition(async () => {
        await markRead(suggestionId, true);
      });
    }
    // Only when the opened suggestion changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submitNote(event: React.FormEvent) {
    event.preventDefault();
    const body = noteBody.trim();
    if (!body) return;
    setSavingNote(true);
    const result = await addNote(suggestionId, body);
    setSavingNote(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNoteBody("");
    setError(null);
    setNotes((prev) => [...prev, result.data]);
    requestAnimationFrame(() => notesEndRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  function changeStatus(next: Status) {
    if (next === suggestion.status) return;
    startTransition(async () => {
      const result = await setStatus(suggestionId, next);
      if (!result.ok) setError(result.error);
      else await refresh();
    });
  }

  function toggleRead() {
    startTransition(async () => {
      const result = await markRead(suggestionId, !suggestion.is_read);
      if (!result.ok) setError(result.error);
    });
  }

  async function removeNote(noteId: string) {
    const result = await deleteNote(noteId);
    if (!result.ok) setError(result.error);
    else setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  const identity = suggestion.is_anonymous
    ? "Submitted anonymously"
    : suggestion.student_name || suggestion.student_email || "No name given";

  return (
    <motion.aside
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      aria-label={`Suggestion: ${suggestion.title}`}
      className="paper flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden lg:sticky lg:top-4"
    >
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={suggestion.status} />
            <span className="text-[12px] font-medium text-navy-soft">
              {CATEGORY_LABELS[suggestion.category]}
            </span>
            {!suggestion.is_read && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent">
                <span className="h-[7px] w-[7px] rounded-full bg-accent" aria-hidden />
                Unread
              </span>
            )}
          </div>
          <h2 className="mt-2 text-[19px] leading-snug font-bold text-navy">
            {suggestion.title}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="btn-quiet shrink-0 px-2 py-2" aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {error && (
          <p role="alert" className="mb-4 rounded-[10px] border border-[#f0c4bb] bg-[#fdeee7] px-3 py-2 text-sm font-medium text-[#8d2b0d]">
            {error}
          </p>
        )}

        {/* who and when */}
        <dl className="grid gap-x-6 gap-y-3 border-b border-rule pb-5 sm:grid-cols-2">
          <div>
            <dt className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">Submitted</dt>
            <dd className="mt-1 text-sm text-navy">
              <LocalTime iso={suggestion.created_at} />
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">From</dt>
            <dd className="mt-1 text-sm text-navy">{identity}</dd>
          </div>
          {suggestion.student_email && (
            <div className="sm:col-span-2">
              <dt className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">Email</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <a
                  href={`mailto:${suggestion.student_email}`}
                  className="text-sm font-medium text-accent-ink underline underline-offset-2 break-all"
                >
                  {suggestion.student_email}
                </a>
                <CopyButton
                  value={suggestion.student_email}
                  label="Copy email"
                  className="btn-quiet px-2 py-1 text-[12.5px]"
                />
              </dd>
            </div>
          )}
        </dl>

        {/* the suggestion */}
        <section className="border-b border-rule py-5">
          <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">
            The idea
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap text-navy">
            {suggestion.description}
          </p>
        </section>

        <section className="border-b border-rule py-5">
          <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">
            Why it would improve the school
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap text-navy">
            {suggestion.improvement_reason}
          </p>
        </section>

        {/* status control */}
        <section className="border-b border-rule py-5">
          <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">
            Status
          </h3>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {STATUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={pending}
                onClick={() => changeStatus(option.value)}
                aria-pressed={suggestion.status === option.value}
                className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  suggestion.status === option.value
                    ? "border-navy bg-navy text-white"
                    : "border-rule bg-white text-navy hover:bg-paper-deep"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={toggleRead} disabled={pending} className="btn-quiet">
              {suggestion.is_read ? "Mark as unread" : "Mark as read"}
            </button>
            {suggestion.status !== "archived" ? (
              <button
                type="button"
                onClick={() => changeStatus("archived")}
                disabled={pending}
                className="btn-quiet"
              >
                <ArchiveIcon /> Archive
              </button>
            ) : (
              <button
                type="button"
                onClick={() => changeStatus("reviewing")}
                disabled={pending}
                className="btn-quiet"
              >
                <ArchiveIcon /> Restore from archive
              </button>
            )}
          </div>
        </section>

        {/* shared internal notes */}
        <section className="border-b border-rule py-5">
          <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">
            Internal notes
          </h3>
          <p className="mt-1 text-[12.5px] text-navy-soft">
            Only the two of you can see these. Students never do.
          </p>

          <div className="mt-3 space-y-2.5">
            {loading && <p className="text-sm text-navy-soft">Loading notes…</p>}
            {!loading && notes.length === 0 && (
              <p className="text-sm text-navy-soft">No notes yet.</p>
            )}
            {notes.map((note) => (
              <div key={note.id} className="rounded-[10px] border border-rule bg-paper-deep/45 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-navy">
                    {note.author_email === currentEmail ? "You" : note.author_email}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-navy-soft">
                    <LocalTime iso={note.created_at} />
                  </span>
                </div>
                <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-navy">
                  {note.body}
                </p>
                {note.author_email === currentEmail && (
                  <button
                    type="button"
                    onClick={() => removeNote(note.id)}
                    className="mt-1.5 text-[12px] font-medium text-navy-soft underline underline-offset-2 hover:text-[#b23417]"
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
            <div ref={notesEndRef} />
          </div>

          <form onSubmit={submitNote} className="mt-3">
            <label htmlFor="note-body" className="sr-only">
              Add an internal note
            </label>
            <textarea
              id="note-body"
              rows={3}
              value={noteBody}
              maxLength={LIMITS.note}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Add a note for your co-president…"
              className="field resize-y text-[14px]"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-navy-soft/70 tabular-nums">
                {noteBody.length}/{LIMITS.note}
              </span>
              <button
                type="submit"
                disabled={savingNote || noteBody.trim().length === 0}
                className="btn-primary px-4 py-2 text-sm"
              >
                {savingNote ? "Saving…" : "Add note"}
              </button>
            </div>
          </form>
        </section>

        {/* status history */}
        <section className="py-5">
          <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">
            History
          </h3>
          <ol className="mt-3 space-y-2.5">
            {history.length === 0 && !loading && (
              <li className="text-sm text-navy-soft">No changes recorded yet.</li>
            )}
            {history.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-[13.5px]">
                <span className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-navy/25" aria-hidden />
                <span className="text-navy">
                  {entry.from_status
                    ? `${STATUS_LABELS[entry.from_status]} → ${STATUS_LABELS[entry.to_status]}`
                    : `Received as ${STATUS_LABELS[entry.to_status]}`}
                  <span className="block text-[12px] text-navy-soft">
                    <LocalTime iso={entry.created_at} />
                    {entry.changed_by ? ` · ${entry.changed_by === currentEmail ? "you" : entry.changed_by}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </motion.aside>
  );
}
