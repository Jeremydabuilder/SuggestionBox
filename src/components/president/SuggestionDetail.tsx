"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion } from "framer-motion";
import {
  CATEGORY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type InternalNote,
  type StatusHistoryEntry,
  type Status,
  type Suggestion,
  type SuggestionMatch,
} from "@/lib/types";
import {
  LEVEL_LABEL,
  duplicatesOf,
  matchesFor,
  otherIdIn,
  relatedGroupSize,
  similarityLevel,
} from "@/lib/duplicates";
import { LIMITS } from "@/lib/validation";
import {
  addNote,
  confirmMatch,
  deleteNote,
  dismissMatch,
  loadDetail,
  markRead,
  restoreMatch,
  setPrimarySuggestion,
  setStatus,
} from "@/app/president/actions";
import { moveToTrash } from "@/app/president/trash-actions";
import {
  ArchiveIcon,
  CloseIcon,
  CopyButton,
  LocalTime,
  StatusChip,
} from "./ui";

export default function SuggestionDetail({
  suggestion,
  allSuggestions,
  matches,
  currentEmail,
  onClose,
  onOpenSuggestion,
  refreshSignal,
}: {
  suggestion: Suggestion;
  allSuggestions: Suggestion[];
  matches: SuggestionMatch[];
  currentEmail: string;
  onClose: () => void;
  onOpenSuggestion: (id: string) => void;
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
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [trashReason, setTrashReason] = useState("");
  const [trashing, setTrashing] = useState(false);
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

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    if (!query.matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

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

  async function confirmMoveToTrash() {
    setTrashing(true);
    const result = await moveToTrash(suggestionId, trashReason);
    setTrashing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // A trashed suggestion is immediately invisible to every ordinary
    // read, this panel included — close it rather than show a now-stale
    // detail view.
    onClose();
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
      className="paper fixed inset-x-3 top-3 bottom-3 z-50 flex flex-col overflow-hidden shadow-2xl sm:inset-x-6 lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:shadow-none"
    >
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-rule bg-white px-4 py-4 sm:px-5">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
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
            {!trashConfirmOpen && (
              <button
                type="button"
                onClick={() => setTrashConfirmOpen(true)}
                disabled={pending}
                className="btn-quiet border-rose-300 text-rose-800"
              >
                Move to Trash
              </button>
            )}
          </div>
          {trashConfirmOpen && (
            <div className="mt-3 rounded-[8px] border border-rose-200 bg-rose-50/60 p-3">
              <p className="text-[12.5px] font-semibold text-rose-900">
                Move this suggestion to Trash? It is fully recoverable until someone permanently deletes it from there.
              </p>
              <label className="mt-2 block text-[11.5px] font-semibold text-navy-soft">Reason (optional, seen only by co-presidents)</label>
              <input
                type="text"
                value={trashReason}
                onChange={(e) => setTrashReason(e.target.value)}
                maxLength={500}
                className="mt-1 w-full rounded-[8px] border border-rule px-2.5 py-1.5 text-[13px]"
                placeholder="e.g. duplicate of another idea"
              />
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={confirmMoveToTrash}
                  disabled={trashing}
                  className="btn-quiet border-rose-300 text-rose-800"
                >
                  {trashing ? "Moving…" : "Confirm move to Trash"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTrashConfirmOpen(false);
                    setTrashReason("");
                  }}
                  disabled={trashing}
                  className="btn-quiet"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {/* possible duplicates */}
        <SimilarSuggestions
          suggestion={suggestion}
          allSuggestions={allSuggestions}
          matches={matches}
          pending={pending}
          currentEmail={currentEmail}
          onOpenSuggestion={onOpenSuggestion}
          onError={setError}
          startTransition={startTransition}
        />

        {/* shared internal notes */}
        <section className="border-b border-rule py-5">
          <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">
            Internal notes
          </h3>
          <p className="mt-1 text-[12.5px] text-navy-soft">
            Internal notes are for the co-presidents. They are not shown to students.
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


/* ------------------------------------------------------------------ */
/* Similar suggestions                                                 */
/* ------------------------------------------------------------------ */
/*
 * Advisory only. Every control here records a decision about the
 * RELATIONSHIP between two suggestions. Nothing deletes, archives, merges
 * or rejects a submission, and both students' words and contact details
 * survive every action on this panel untouched.
 */

function SimilarSuggestions({
  suggestion,
  allSuggestions,
  matches,
  pending,
  currentEmail,
  onOpenSuggestion,
  onError,
  startTransition,
}: {
  suggestion: Suggestion;
  allSuggestions: Suggestion[];
  matches: SuggestionMatch[];
  pending: boolean;
  currentEmail: string;
  onOpenSuggestion: (id: string) => void;
  onError: (message: string | null) => void;
  startTransition: (fn: () => void) => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);

  const byId = useMemo(
    () => new Map(allSuggestions.map((s) => [s.id, s])),
    [allSuggestions],
  );

  const [mine, dismissed] = useMemo(() => {
    const rows = matchesFor(suggestion.id, matches)
      .map((match) => ({ match, other: byId.get(otherIdIn(match, suggestion.id)) }))
      .filter((row): row is { match: SuggestionMatch; other: Suggestion } => Boolean(row.other))
      .sort((a, b) => b.match.score - a.match.score);
    return [
      rows.filter((r) => r.match.state !== "dismissed"),
      rows.filter((r) => r.match.state === "dismissed"),
    ];
  }, [matches, suggestion.id, byId]);
  const related = mine;

  const groupSize = relatedGroupSize(suggestion, allSuggestions);
  const filedUnder = suggestion.primary_suggestion_id
    ? byId.get(suggestion.primary_suggestion_id)
    : null;
  const ownDuplicates = duplicatesOf(suggestion.id, allSuggestions);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) onError(result.error ?? "That didn't work. Try again.");
      else onError(null);
    });
  }

  if (
    related.length === 0 &&
    dismissed.length === 0 &&
    !filedUnder &&
    ownDuplicates.length === 0
  ) {
    return null;
  }

  return (
    <section className="border-b border-rule py-5">
      <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">
        Similar suggestions
      </h3>
      <p className="mt-1 text-[12.5px] text-navy-soft">
        Found by comparing wording, keywords and category. Nothing is merged or removed —
        every submission is kept exactly as it was sent.
      </p>

      {/* how many submissions are behind the same idea */}
      {groupSize > 1 && (
        <p className="mt-3 rounded-[10px] border border-navy/20 bg-navy/5 px-3 py-2 text-[13px] font-semibold text-navy">
          {groupSize} submissions are filed as the same idea.
        </p>
      )}

      {filedUnder && (
        <div className="mt-3 rounded-[10px] border border-rule bg-paper-deep/45 px-3.5 py-2.5">
          <p className="text-[12.5px] text-navy-soft">Filed under</p>
          <p className="mt-0.5 text-[14px] font-semibold text-navy">{filedUnder.title}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-quiet px-2.5 py-1 text-[12.5px]"
              onClick={() => onOpenSuggestion(filedUnder.id)}
            >
              Open it
            </button>
            <button
              type="button"
              disabled={pending}
              className="btn-quiet px-2.5 py-1 text-[12.5px]"
              onClick={() => run(() => setPrimarySuggestion(suggestion.id, null))}
            >
              Unlink
            </button>
          </div>
        </div>
      )}

      {!filedUnder && ownDuplicates.length > 0 && (
        <p className="mt-3 text-[13px] font-medium text-navy">
          This is the primary suggestion for {ownDuplicates.length} other submission
          {ownDuplicates.length === 1 ? "" : "s"}.
        </p>
      )}

      <ul className="mt-3 space-y-2.5">
        {related.map(({ match, other }) => {
          const level = similarityLevel(match.score);
          const confirmed = match.state === "confirmed";
          const isFiledHere = other.primary_suggestion_id === suggestion.id;
          return (
            <li
              key={match.id}
              className={`rounded-[10px] border px-3.5 py-3 ${
                confirmed ? "border-navy/30 bg-navy/[0.04]" : "border-rule bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[14px] leading-snug font-semibold text-navy">
                  {other.title}
                </p>
                <span
                  title={`Similarity ${Math.round(match.score * 100)}%`}
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${
                    level === "strong"
                      ? "border-amber-400 bg-amber-100 text-amber-900"
                      : level === "moderate"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-rule bg-paper-deep/60 text-navy-soft"
                  }`}
                >
                  {LEVEL_LABEL[level]} · {Math.round(match.score * 100)}%
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-navy-soft">
                <span className="rounded-full border border-rule px-2 py-0.5 font-medium">
                  {CATEGORY_LABELS[other.category]}
                </span>
                <StatusChip status={other.status} />
                <LocalTime iso={other.created_at} />
                {confirmed && (
                  <span className="font-semibold text-navy">Marked related</span>
                )}
              </div>

              {Array.isArray(match.breakdown?.sharedKeywords) &&
                match.breakdown.sharedKeywords.length > 0 && (
                  <p className="mt-1.5 text-[12px] text-navy-soft">
                    Shared: {match.breakdown.sharedKeywords.slice(0, 6).join(", ")}
                  </p>
                )}

              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-quiet px-2.5 py-1 text-[12.5px]"
                  onClick={() => onOpenSuggestion(other.id)}
                >
                  Open
                </button>
                {!confirmed && (
                  <button
                    type="button"
                    disabled={pending}
                    className="btn-quiet px-2.5 py-1 text-[12.5px]"
                    onClick={() => run(() => confirmMatch(match.id))}
                  >
                    Mark as related
                  </button>
                )}
                {!isFiledHere && (
                  <button
                    type="button"
                    disabled={pending}
                    className="btn-quiet px-2.5 py-1 text-[12.5px]"
                    onClick={() =>
                      run(async () => {
                        const linked = await setPrimarySuggestion(other.id, suggestion.id);
                        if (!linked.ok) return linked;
                        return confirmMatch(match.id);
                      })
                    }
                  >
                    Make this one primary
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  className="btn-quiet px-2.5 py-1 text-[12.5px]"
                  onClick={() => run(() => dismissMatch(match.id))}
                >
                  Not a duplicate
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {dismissed.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            className="text-[12.5px] font-medium text-navy-soft underline underline-offset-2 hover:text-navy"
          >
            {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed match
            {dismissed.length === 1 ? "" : "es"}
          </button>

          {showDismissed && (
            <ul className="mt-2.5 space-y-2">
              {dismissed.map(({ match, other }) => (
                <li
                  key={match.id}
                  className="rounded-[10px] border border-dashed border-rule bg-paper-deep/40 px-3.5 py-2.5"
                >
                  <p className="text-[13.5px] font-semibold text-navy/70">{other.title}</p>
                  <p className="mt-0.5 text-[12px] text-navy-soft">
                    Dismissed
                    {match.decided_by
                      ? ` by ${match.decided_by === currentEmail ? "you" : match.decided_by}`
                      : ""}
                    {match.decided_at ? " on " : ""}
                    {match.decided_at ? <LocalTime iso={match.decided_at} /> : null}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-quiet px-2.5 py-1 text-[12.5px]"
                      onClick={() => onOpenSuggestion(other.id)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      className="btn-quiet px-2.5 py-1 text-[12.5px]"
                      onClick={() => run(() => restoreMatch(match.id))}
                    >
                      Undo dismissal
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
