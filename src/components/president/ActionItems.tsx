"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createActionItem,
  deleteActionItem,
  listActionItems,
  setActionItemCompleted,
  updateActionItem,
} from "@/app/president/action-items-actions";
import { listMeetingBriefs } from "@/app/president/workspace-actions";
import { classifyDeadline, type ActionItem } from "@/lib/decisions-actions-store";
import type { MeetingBriefSummary } from "@/lib/meeting-brief-store";
import type { Suggestion } from "@/lib/types";
import SuggestionPicker from "./SuggestionPicker";

export interface PrefillAction {
  text: string;
  meetingId: string | null;
  citedSuggestionIds: string[];
}

type StatusFilter = "all" | "open" | "completed" | "overdue" | "due_soon";
type MeetingFilter = "all" | "standalone" | string;
type SortOrder = "deadline" | "newest" | "oldest";

const DEADLINE_BADGE: Record<"overdue" | "due_soon", string> = {
  overdue: "border-rose-300 bg-rose-50 text-rose-900",
  due_soon: "border-amber-300 bg-amber-50 text-amber-900",
};

export default function ActionItems({
  suggestions,
  onOpenSuggestion,
  prefill,
  onPrefillConsumed,
}: {
  suggestions: Suggestion[];
  onOpenSuggestion: (id: string) => void;
  prefill?: PrefillAction | null;
  onPrefillConsumed?: () => void;
}) {
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<MeetingBriefSummary[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [meetingFilter, setMeetingFilter] = useState<MeetingFilter>("all");
  const [sort, setSort] = useState<SortOrder>("deadline");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [itemResult, meetingResult] = await Promise.all([listActionItems(), listMeetingBriefs(false)]);
    if (!itemResult.ok) {
      setError(itemResult.error);
      return;
    }
    setError(null);
    setItems(itemResult.data);
    if (meetingResult.ok) setMeetings(meetingResult.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (prefill) setFormOpen(true);
  }, [prefill]);

  const filtered = useMemo(() => {
    if (!items) return [];
    let list = items;
    if (statusFilter === "open") list = list.filter((a) => !a.completed);
    else if (statusFilter === "completed") list = list.filter((a) => a.completed);
    else if (statusFilter === "overdue") list = list.filter((a) => !a.completed && classifyDeadline(a.deadline) === "overdue");
    else if (statusFilter === "due_soon") list = list.filter((a) => !a.completed && classifyDeadline(a.deadline) === "due_soon");

    if (meetingFilter === "standalone") list = list.filter((a) => !a.meetingId);
    else if (meetingFilter !== "all") list = list.filter((a) => a.meetingId === meetingFilter);

    return [...list].sort((a, b) => {
      if (sort === "deadline") {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      }
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === "newest" ? -diff : diff;
    });
  }, [items, statusFilter, meetingFilter, sort]);

  async function refreshAfterWrite() {
    await load();
  }

  async function toggleCompleted(item: ActionItem) {
    setBusyId(item.id);
    const result = await setActionItemCompleted(item.id, !item.completed);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshAfterWrite();
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const result = await deleteActionItem(id);
    setBusyId(null);
    setConfirmingDeleteId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshAfterWrite();
  }

  if (error && !items) {
    return (
      <div className="paper px-5 py-6">
        <p role="alert" className="text-sm font-medium text-rose-800">{error}</p>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="paper px-5 py-10 text-center">
        <p className="text-sm text-navy-soft">Loading action items…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="action-status-filter">Filter by status</label>
        <select
          id="action-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="field w-auto cursor-pointer py-[0.6rem] text-[13px]"
        >
          <option value="all">All actions</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due soon</option>
        </select>
        <label className="sr-only" htmlFor="action-meeting-filter">Filter by meeting</label>
        <select
          id="action-meeting-filter"
          value={meetingFilter}
          onChange={(e) => setMeetingFilter(e.target.value)}
          className="field w-auto cursor-pointer py-[0.6rem] text-[13px]"
        >
          <option value="all">All meetings</option>
          <option value="standalone">Standalone only</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>{m.headline}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="action-sort">Sort</label>
        <select
          id="action-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOrder)}
          className="field w-auto cursor-pointer py-[0.6rem] text-[13px]"
        >
          <option value="deadline">By deadline</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="btn-primary ml-auto py-2 text-[13px]"
        >
          {formOpen ? "Cancel" : "Add action"}
        </button>
      </div>

      {error && <p role="alert" className="mb-3 text-[13px] font-medium text-rose-800">{error}</p>}

      {formOpen && (
        <div className="mb-3">
          <ActionForm
            suggestions={suggestions}
            meetings={meetings}
            initialText={prefill?.text}
            initialMeetingId={prefill?.meetingId ?? null}
            initialCitedIds={prefill?.citedSuggestionIds}
            onCancel={() => {
              setFormOpen(false);
              onPrefillConsumed?.();
            }}
            onSubmit={async (input) => {
              const result = await createActionItem(input);
              if (!result.ok) return result.error;
              setFormOpen(false);
              onPrefillConsumed?.();
              await refreshAfterWrite();
              return null;
            }}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="paper px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold text-navy">
            {items.length === 0 ? "No action items yet" : "Nothing matches those filters"}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-navy-soft">
            {items.length === 0
              ? "Add an action manually, or add one from a saved meeting brief."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((item) => {
            const deadlineStatus = item.completed ? "none" : classifyDeadline(item.deadline);
            return (
              <li key={item.id} className="paper px-4 py-3.5 sm:px-5">
                {editingId === item.id ? (
                  <ActionForm
                    suggestions={suggestions}
                    meetings={meetings}
                    initialText={item.actionText}
                    initialDeadline={item.deadline}
                    initialMeetingId={item.meetingId}
                    initialCitedIds={item.citations.map((c) => c.id)}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (input) => {
                      const result = await updateActionItem({ id: item.id, ...input });
                      if (!result.ok) return result.error;
                      setEditingId(null);
                      await refreshAfterWrite();
                      return null;
                    }}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-start gap-3">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          disabled={busyId === item.id}
                          onChange={() => toggleCompleted(item)}
                          aria-label={item.completed ? "Mark as not completed" : "Mark as completed"}
                          className="mt-1 h-[18px] w-[18px] shrink-0 accent-[#e24e1b]"
                        />
                        <span className={`text-[14.5px] leading-relaxed ${item.completed ? "text-navy-soft line-through" : "text-navy"}`}>
                          {item.actionText}
                        </span>
                      </label>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => setEditingId(item.id)} className="btn-quiet">Edit</button>
                        {confirmingDeleteId === item.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id)}
                              disabled={busyId === item.id}
                              className="btn-quiet border-rose-300 text-rose-800"
                            >
                              {busyId === item.id ? "Deleting…" : "Confirm delete"}
                            </button>
                            <button type="button" onClick={() => setConfirmingDeleteId(null)} className="btn-quiet">Cancel</button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirmingDeleteId(item.id)} className="btn-quiet">Delete</button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[30px]">
                      {item.deadline && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            deadlineStatus === "overdue" || deadlineStatus === "due_soon"
                              ? DEADLINE_BADGE[deadlineStatus]
                              : "border-rule bg-paper text-navy-soft"
                          }`}
                        >
                          {deadlineStatus === "overdue" ? "Overdue · " : deadlineStatus === "due_soon" ? "Due soon · " : "Due "}
                          {new Date(`${item.deadline}T00:00:00`).toLocaleDateString()}
                        </span>
                      )}
                      {item.meetingHeadline ? (
                        <span className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[11px] font-semibold text-navy-soft">
                          {item.meetingHeadline}
                        </span>
                      ) : (
                        <span className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[11px] font-semibold text-navy-soft">
                          Standalone
                        </span>
                      )}
                      {item.citations.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onOpenSuggestion(c.id)}
                          title={`Open: ${c.title}`}
                          className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-900 hover:bg-violet-200"
                        >
                          {c.title}
                        </button>
                      ))}
                    </div>

                    <p className="mt-2.5 pl-[30px] text-[11px] text-navy-soft">
                      Added by {item.createdBy} on {new Date(item.createdAt).toLocaleString()}
                      {item.updatedAt !== item.createdAt && ` · last edited by ${item.updatedBy} on ${new Date(item.updatedAt).toLocaleString()}`}
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface ActionFormValues {
  actionText: string;
  deadline: string | null;
  meetingId: string | null;
  citedSuggestionIds: string[];
}

function ActionForm({
  suggestions,
  meetings,
  initialText,
  initialDeadline,
  initialMeetingId,
  initialCitedIds,
  onCancel,
  onSubmit,
}: {
  suggestions: Suggestion[];
  meetings: MeetingBriefSummary[];
  initialText?: string;
  initialDeadline?: string | null;
  initialMeetingId?: string | null;
  initialCitedIds?: string[];
  onCancel: () => void;
  onSubmit: (input: ActionFormValues) => Promise<string | null>;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [deadline, setDeadline] = useState(initialDeadline ?? "");
  const [meetingId, setMeetingId] = useState<string>(initialMeetingId ?? "");
  const [citedIds, setCitedIds] = useState<string[]>(initialCitedIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) {
      setError("Write the action first.");
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await onSubmit({
      actionText: text.trim(),
      deadline: deadline || null,
      meetingId: meetingId || null,
      citedSuggestionIds: citedIds,
    });
    setSaving(false);
    if (failure) setError(failure);
  }

  return (
    <div className="rounded-[12px] border border-rule bg-paper-deep/50 p-4">
      <label htmlFor="action-text" className="text-sm font-semibold text-navy">Action</label>
      <textarea
        id="action-text"
        className="field mt-1.5 resize-y text-[13.5px]"
        rows={2}
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        placeholder="What needs to happen?"
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="action-deadline" className="text-sm font-semibold text-navy">Deadline (optional)</label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="action-deadline"
              type="date"
              value={deadline}
              disabled={saving}
              onChange={(e) => setDeadline(e.target.value)}
              className="field text-[13.5px]"
            />
            {deadline && (
              <button type="button" onClick={() => setDeadline("")} disabled={saving} className="btn-quiet shrink-0">
                Clear
              </button>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="action-meeting" className="text-sm font-semibold text-navy">Connected meeting</label>
          <select
            id="action-meeting"
            value={meetingId}
            disabled={saving}
            onChange={(e) => setMeetingId(e.target.value)}
            className="field mt-1.5 cursor-pointer text-[13.5px]"
          >
            <option value="">Standalone (no meeting)</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>{m.headline}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <SuggestionPicker suggestions={suggestions} selectedIds={citedIds} onChange={setCitedIds} disabled={saving} />
      </div>

      {error && <p role="alert" className="mt-3 text-[13px] font-medium text-rose-800">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-quiet">Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary py-2 text-[13px]">
          {saving ? "Saving…" : "Save action"}
        </button>
      </div>
    </div>
  );
}
