"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDecision,
  deleteDecision,
  listDecisions,
  updateDecision,
} from "@/app/president/decisions-actions";
import { listMeetingBriefs } from "@/app/president/workspace-actions";
import type { Decision } from "@/lib/decisions-actions-store";
import type { MeetingBriefSummary } from "@/lib/meeting-brief-store";
import type { Suggestion } from "@/lib/types";
import SuggestionPicker from "./SuggestionPicker";

export interface PrefillDecision {
  text: string;
  meetingId: string | null;
  citedSuggestionIds: string[];
}

type MeetingFilter = "all" | "standalone" | string;
type SortOrder = "newest" | "oldest";

export default function DecisionLog({
  suggestions,
  onOpenSuggestion,
  prefill,
  onPrefillConsumed,
}: {
  suggestions: Suggestion[];
  onOpenSuggestion: (id: string) => void;
  /** Set by "Add to Decision Log" elsewhere in the workspace; consumed once, then cleared. */
  prefill?: PrefillDecision | null;
  onPrefillConsumed?: () => void;
}) {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<MeetingBriefSummary[]>([]);

  const [query, setQuery] = useState("");
  const [meetingFilter, setMeetingFilter] = useState<MeetingFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [decisionResult, meetingResult] = await Promise.all([listDecisions(), listMeetingBriefs(false)]);
    if (!decisionResult.ok) {
      setError(decisionResult.error);
      return;
    }
    setError(null);
    setDecisions(decisionResult.data);
    if (meetingResult.ok) setMeetings(meetingResult.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (prefill) setFormOpen(true);
  }, [prefill]);

  const filtered = useMemo(() => {
    if (!decisions) return [];
    const needle = query.trim().toLowerCase();
    let list = decisions;
    if (needle) list = list.filter((d) => d.decisionText.toLowerCase().includes(needle));
    if (meetingFilter === "standalone") list = list.filter((d) => !d.meetingId);
    else if (meetingFilter !== "all") list = list.filter((d) => d.meetingId === meetingFilter);
    return [...list].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === "newest" ? -diff : diff;
    });
  }, [decisions, query, meetingFilter, sort]);

  async function refreshAfterWrite() {
    await load();
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const result = await deleteDecision(id);
    setBusyId(null);
    setConfirmingDeleteId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshAfterWrite();
  }

  if (error && !decisions) {
    return (
      <div className="paper px-5 py-6">
        <p role="alert" className="text-sm font-medium text-rose-800">{error}</p>
      </div>
    );
  }

  if (!decisions) {
    return (
      <div className="paper px-5 py-10 text-center">
        <p className="text-sm text-navy-soft">Loading the decision log…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="decision-search">Search decisions</label>
        <input
          id="decision-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search decisions…"
          className="field max-w-xs flex-1 text-[13px]"
        />
        <label className="sr-only" htmlFor="decision-meeting-filter">Filter by meeting</label>
        <select
          id="decision-meeting-filter"
          value={meetingFilter}
          onChange={(e) => setMeetingFilter(e.target.value)}
          className="field w-auto cursor-pointer py-[0.6rem] text-[13px]"
        >
          <option value="all">All decisions</option>
          <option value="standalone">Standalone only</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>{m.headline}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="decision-sort">Sort</label>
        <select
          id="decision-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOrder)}
          className="field w-auto cursor-pointer py-[0.6rem] text-[13px]"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="btn-primary ml-auto py-2 text-[13px]"
        >
          {formOpen ? "Cancel" : "Add decision"}
        </button>
      </div>

      {error && <p role="alert" className="mb-3 text-[13px] font-medium text-rose-800">{error}</p>}

      {formOpen && (
        <div className="mb-3">
          <DecisionForm
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
              const result = await createDecision(input);
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
            {decisions.length === 0 ? "No decisions recorded yet" : "Nothing matches those filters"}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-navy-soft">
            {decisions.length === 0
              ? "Record a decision manually, or add one from a saved meeting brief."
              : "Try a different search or filter."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((decision) => (
            <li key={decision.id} className="paper px-4 py-3.5 sm:px-5">
              {editingId === decision.id ? (
                <DecisionForm
                  suggestions={suggestions}
                  meetings={meetings}
                  initialText={decision.decisionText}
                  initialMeetingId={decision.meetingId}
                  initialCitedIds={decision.citations.map((c) => c.id)}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (input) => {
                    const result = await updateDecision({ id: decision.id, ...input });
                    if (!result.ok) return result.error;
                    setEditingId(null);
                    await refreshAfterWrite();
                    return null;
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-navy">{decision.decisionText}</p>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setEditingId(decision.id)} className="btn-quiet">Edit</button>
                      {confirmingDeleteId === decision.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDelete(decision.id)}
                            disabled={busyId === decision.id}
                            className="btn-quiet border-rose-300 text-rose-800"
                          >
                            {busyId === decision.id ? "Deleting…" : "Confirm delete"}
                          </button>
                          <button type="button" onClick={() => setConfirmingDeleteId(null)} className="btn-quiet">Cancel</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmingDeleteId(decision.id)} className="btn-quiet">Delete</button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {decision.meetingHeadline ? (
                      <span className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[11px] font-semibold text-navy-soft">
                        {decision.meetingHeadline}
                      </span>
                    ) : (
                      <span className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[11px] font-semibold text-navy-soft">
                        Standalone
                      </span>
                    )}
                    {decision.citations.map((c) => (
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

                  <p className="mt-2.5 text-[11px] text-navy-soft">
                    Recorded by {decision.createdBy} on {new Date(decision.createdAt).toLocaleString()}
                    {decision.updatedAt !== decision.createdAt && ` · last edited by ${decision.updatedBy} on ${new Date(decision.updatedAt).toLocaleString()}`}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface DecisionFormValues {
  decisionText: string;
  meetingId: string | null;
  citedSuggestionIds: string[];
}

function DecisionForm({
  suggestions,
  meetings,
  initialText,
  initialMeetingId,
  initialCitedIds,
  onCancel,
  onSubmit,
}: {
  suggestions: Suggestion[];
  meetings: MeetingBriefSummary[];
  initialText?: string;
  initialMeetingId?: string | null;
  initialCitedIds?: string[];
  onCancel: () => void;
  onSubmit: (input: DecisionFormValues) => Promise<string | null>;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [meetingId, setMeetingId] = useState<string>(initialMeetingId ?? "");
  const [citedIds, setCitedIds] = useState<string[]>(initialCitedIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) {
      setError("Write the decision first.");
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await onSubmit({ decisionText: text.trim(), meetingId: meetingId || null, citedSuggestionIds: citedIds });
    setSaving(false);
    if (failure) setError(failure);
  }

  return (
    <div className="rounded-[12px] border border-rule bg-paper-deep/50 p-4">
      <label htmlFor="decision-text" className="text-sm font-semibold text-navy">Decision</label>
      <textarea
        id="decision-text"
        className="field mt-1.5 resize-y text-[13.5px]"
        rows={3}
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        placeholder="What was decided?"
      />

      <div className="mt-3">
        <label htmlFor="decision-meeting" className="text-sm font-semibold text-navy">Connected meeting</label>
        <select
          id="decision-meeting"
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

      <div className="mt-3">
        <SuggestionPicker suggestions={suggestions} selectedIds={citedIds} onChange={setCitedIds} disabled={saving} />
      </div>

      {error && <p role="alert" className="mt-3 text-[13px] font-medium text-rose-800">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-quiet">Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary py-2 text-[13px]">
          {saving ? "Saving…" : "Save decision"}
        </button>
      </div>
    </div>
  );
}
