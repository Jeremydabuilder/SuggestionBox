"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  archiveMeetingBrief,
  getMeetingBrief,
  listMeetingBriefs,
  restoreMeetingBrief,
  updateMeetingBrief,
} from "@/app/president/workspace-actions";
import type { MeetingBriefSummary, SavedMeetingBrief } from "@/lib/meeting-brief-store";

const STATE_LABEL: Record<SavedMeetingBrief["state"], string> = {
  draft: "Draft",
  saved: "Saved",
  archived: "Archived",
};

const STATE_STYLE: Record<SavedMeetingBrief["state"], string> = {
  draft: "border-amber-300 bg-amber-50 text-amber-900",
  saved: "border-emerald-200 bg-emerald-50 text-emerald-900",
  archived: "border-navy/20 bg-navy/5 text-navy/70",
};

export default function MeetingHistory({ refreshSignal }: { refreshSignal: number }) {
  const [showArchived, setShowArchived] = useState(false);
  const [briefs, setBriefs] = useState<MeetingBriefSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SavedMeetingBrief | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListError(null);
    const result = await listMeetingBriefs(showArchived);
    if (!result.ok) {
      setListError(result.error);
      return;
    }
    setBriefs(result.data);
  }, [showArchived]);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshSignal]);

  async function openBrief(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    const result = await getMeetingBrief(id);
    setDetailLoading(false);
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    setDetail(result.data);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }

  async function toggleArchive(id: string, currentlyArchived: boolean) {
    setBusyId(id);
    const result = currentlyArchived ? await restoreMeetingBrief(id) : await archiveMeetingBrief(id);
    setBusyId(null);
    if (!result.ok) {
      setListError(result.error);
      return;
    }
    await loadList();
    if (selectedId === id) await openBrief(id);
  }

  if (listError && !briefs) {
    return (
      <div className="paper px-5 py-6">
        <p role="alert" className="text-sm font-medium text-rose-800">{listError}</p>
      </div>
    );
  }

  if (!briefs) {
    return (
      <div className="paper px-5 py-10 text-center">
        <p className="text-sm text-navy-soft">Loading meeting history…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-navy-soft">
          {briefs.length} saved meeting{briefs.length === 1 ? "" : "s"}
        </p>
        <label className="flex items-center gap-2 text-[13px] font-medium text-navy">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 accent-[#e24e1b]"
          />
          Show archived
        </label>
      </div>

      {listError && (
        <p role="alert" className="mb-3 text-[13px] font-medium text-rose-800">{listError}</p>
      )}

      {briefs.length === 0 ? (
        <div className="paper px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold text-navy">No saved meetings yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-navy-soft">
            Prepare a meeting from the inbox and save it to see it here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {briefs.map((brief) => (
            <li key={brief.id} className="paper px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATE_STYLE[brief.state]}`}>
                      {STATE_LABEL[brief.state]}
                    </span>
                    <span className="text-[12px] text-navy-soft">
                      {new Date(brief.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="mt-1.5 truncate text-[15.5px] font-bold text-navy">{brief.headline}</h3>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-navy-soft">
                    {brief.executiveSummary}
                  </p>
                  <p className="mt-2 text-[12px] text-navy-soft">
                    {brief.citationCount} cited suggestion{brief.citationCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={() => openBrief(brief.id)} className="btn-quiet">
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleArchive(brief.id, brief.state === "archived")}
                    disabled={busyId === brief.id}
                    className="btn-quiet"
                  >
                    {busyId === brief.id
                      ? "Working…"
                      : brief.state === "archived"
                        ? "Restore"
                        : "Archive"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selectedId && (
        <BriefDetailPanel
          briefId={selectedId}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
          onSaved={async () => {
            await loadList();
            await openBrief(selectedId);
          }}
          onArchiveToggled={() => toggleArchive(selectedId, detail?.state === "archived")}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail: read-only by default; Edit is an explicit, separate action.  */
/* ------------------------------------------------------------------ */

function BriefDetailPanel({
  briefId,
  detail,
  loading,
  error,
  onClose,
  onSaved,
  onArchiveToggled,
}: {
  briefId: string;
  detail: SavedMeetingBrief | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onArchiveToggled: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditableForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setSaveError(null);
    setForm(detail ? formFromDetail(detail) : null);
  }, [detail]);

  const citationTitles = useMemo(
    () => new Map((detail?.citations ?? []).map((c) => [c.ref, c.title])),
    [detail],
  );

  async function save() {
    if (!detail || !form) return;
    setSaving(true);
    setSaveError(null);
    const result = await updateMeetingBrief({
      id: briefId,
      content: contentFromForm(form),
      scope: detail.scope,
      sources: detail.citations.map((c) => ({ ref: c.ref, id: c.id })),
      isDraft: form.isDraft,
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setEditing(false);
    await onSaved();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Meeting details"
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/35 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <div className="paper max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-b-none sm:rounded-[16px]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-rule bg-white px-5 py-3.5">
          <p className="eyebrow">Meeting details</p>
          <button type="button" onClick={onClose} className="btn-quiet">
            Close
          </button>
        </div>

        <div className="p-5">
          {loading && <p className="text-sm text-navy-soft">Loading…</p>}
          {error && <p role="alert" className="text-sm font-medium text-rose-800">{error}</p>}

          {detail && form && !editing && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATE_STYLE[detail.state]}`}>
                    {STATE_LABEL[detail.state]}
                  </span>
                  <h2 className="mt-2 text-xl font-bold text-navy">{detail.headline}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-navy-soft">{detail.executiveSummary}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {detail.state !== "archived" && (
                    <button type="button" onClick={() => setEditing(true)} className="btn-quiet">
                      Edit
                    </button>
                  )}
                  <button type="button" onClick={onArchiveToggled} className="btn-quiet">
                    {detail.state === "archived" ? "Restore" : "Archive"}
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <ReadOnlySection title="Agenda">
                  <ol className="space-y-2">
                    {detail.agenda.map((item, i) => (
                      <li key={i} className="rounded-lg border border-rule bg-paper px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-[13.5px] font-bold text-navy">{item.title}</h4>
                          <span className="text-[11px] font-semibold text-navy-soft">{item.minutes} min</span>
                        </div>
                        <p className="mt-1 text-[12.5px] text-navy-soft">{item.whyNow}</p>
                        <RefChips refs={item.suggestionRefs} titles={citationTitles} />
                      </li>
                    ))}
                  </ol>
                </ReadOnlySection>
                <ReadOnlySection title="Quick wins">
                  {item2list(detail.quickWins.map((q) => ({ title: q.title, body: q.nextStep, refs: q.suggestionRefs })), citationTitles)}
                </ReadOnlySection>
                <ReadOnlySection title="Decisions needed">
                  {item2list(detail.decisionsNeeded.map((d) => ({ title: d.question, body: d.context, refs: d.suggestionRefs })), citationTitles)}
                </ReadOnlySection>
                <ReadOnlySection title="Follow-ups">
                  {item2list(detail.followUps.map((f) => ({ title: f.action, body: `${f.suggestedOwner} · ${f.timing}`, refs: f.suggestionRefs })), citationTitles)}
                </ReadOnlySection>
                {detail.watchouts.length > 0 && (
                  <ReadOnlySection title="Watch-outs">
                    <ul className="list-disc space-y-1 pl-5 text-[13px] text-navy-soft">
                      {detail.watchouts.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </ReadOnlySection>
                )}
              </div>

              <p className="mt-5 border-t border-rule pt-3 text-[11px] text-navy-soft">
                Saved by {detail.createdBy} on {new Date(detail.createdAt).toLocaleString()}
                {detail.updatedAt !== detail.createdAt && ` · last edited ${new Date(detail.updatedAt).toLocaleString()}`}
              </p>
            </>
          )}

          {detail && form && editing && (
            <EditForm
              form={form}
              onChange={setForm}
              onCancel={() => {
                setEditing(false);
                setForm(formFromDetail(detail));
                setSaveError(null);
              }}
              onSave={save}
              saving={saving}
              saveError={saveError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ReadOnlySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="eyebrow">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function item2list(
  items: Array<{ title: string; body: string; refs: string[] }>,
  titles: Map<string, string>,
) {
  if (items.length === 0) return <p className="text-[12.5px] text-navy-soft">None.</p>;
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-rule bg-paper px-3 py-2.5">
          <h4 className="text-[13px] font-bold text-navy">{item.title}</h4>
          <p className="mt-1 text-[12px] text-navy-soft">{item.body}</p>
          <RefChips refs={item.refs} titles={titles} />
        </div>
      ))}
    </div>
  );
}

function RefChips({ refs, titles }: { refs: string[]; titles: Map<string, string> }) {
  if (refs.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {refs.map((ref) => (
        <span key={ref} title={titles.get(ref)} className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-900">
          {ref}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit mode: text fields only. Citations carry over unchanged — adding */
/* or removing a citation requires generating a fresh brief.            */
/* ------------------------------------------------------------------ */

interface EditableForm {
  headline: string;
  executiveSummary: string;
  watchouts: string;
  isDraft: boolean;
  agenda: Array<{ title: string; minutes: number; whyNow: string; talkingPoints: string; suggestionRefs: string[] }>;
  quickWins: Array<{ title: string; nextStep: string; suggestionRefs: string[] }>;
  decisionsNeeded: Array<{ question: string; context: string; suggestionRefs: string[] }>;
  followUps: Array<{ action: string; suggestedOwner: string; timing: string; suggestionRefs: string[] }>;
}

function formFromDetail(detail: SavedMeetingBrief): EditableForm {
  return {
    headline: detail.headline,
    executiveSummary: detail.executiveSummary,
    watchouts: detail.watchouts.join("\n"),
    isDraft: detail.state === "draft",
    agenda: detail.agenda.map((a) => ({ ...a, talkingPoints: a.talkingPoints.join("\n") })),
    quickWins: detail.quickWins.map((q) => ({ ...q })),
    decisionsNeeded: detail.decisionsNeeded.map((d) => ({ ...d })),
    followUps: detail.followUps.map((f) => ({ ...f })),
  };
}

function contentFromForm(form: EditableForm) {
  return {
    headline: form.headline.trim(),
    executiveSummary: form.executiveSummary.trim(),
    watchouts: form.watchouts.split("\n").map((w) => w.trim()).filter(Boolean).slice(0, 5),
    agenda: form.agenda.map((a) => ({
      title: a.title.trim(),
      minutes: a.minutes,
      whyNow: a.whyNow.trim(),
      talkingPoints: a.talkingPoints.split("\n").map((p) => p.trim()).filter(Boolean).slice(0, 5),
      suggestionRefs: a.suggestionRefs,
    })),
    quickWins: form.quickWins.map((q) => ({ title: q.title.trim(), nextStep: q.nextStep.trim(), suggestionRefs: q.suggestionRefs })),
    decisionsNeeded: form.decisionsNeeded.map((d) => ({ question: d.question.trim(), context: d.context.trim(), suggestionRefs: d.suggestionRefs })),
    followUps: form.followUps.map((f) => ({
      action: f.action.trim(),
      suggestedOwner: f.suggestedOwner.trim(),
      timing: f.timing.trim(),
      suggestionRefs: f.suggestionRefs,
    })),
  };
}

function EditForm({
  form,
  onChange,
  onCancel,
  onSave,
  saving,
  saveError,
}: {
  form: EditableForm;
  onChange: (form: EditableForm) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-semibold text-navy">Headline</label>
        <input
          className="field mt-1.5"
          value={form.headline}
          onChange={(e) => onChange({ ...form, headline: e.target.value })}
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-navy">Summary</label>
        <textarea
          className="field mt-1.5 resize-y"
          rows={3}
          value={form.executiveSummary}
          onChange={(e) => onChange({ ...form, executiveSummary: e.target.value })}
        />
      </div>

      <div>
        <p className="text-sm font-semibold text-navy">Agenda</p>
        <div className="mt-1.5 space-y-2.5">
          {form.agenda.map((item, i) => (
            <div key={i} className="rounded-lg border border-rule p-3">
              <input
                className="field text-[13px]"
                value={item.title}
                onChange={(e) => {
                  const next = [...form.agenda];
                  next[i] = { ...item, title: e.target.value };
                  onChange({ ...form, agenda: next });
                }}
              />
              <textarea
                className="field mt-2 resize-y text-[13px]"
                rows={2}
                value={item.whyNow}
                onChange={(e) => {
                  const next = [...form.agenda];
                  next[i] = { ...item, whyNow: e.target.value };
                  onChange({ ...form, agenda: next });
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold text-navy">Watch-outs (one per line)</label>
        <textarea
          className="field mt-1.5 resize-y text-[13px]"
          rows={3}
          value={form.watchouts}
          onChange={(e) => onChange({ ...form, watchouts: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 text-[13px] font-medium text-navy">
        <input
          type="checkbox"
          checked={form.isDraft}
          onChange={(e) => onChange({ ...form, isDraft: e.target.checked })}
          className="h-4 w-4 accent-[#e24e1b]"
        />
        Keep as a draft
      </label>

      {saveError && (
        <p role="alert" className="text-[13px] font-medium text-rose-800">{saveError}</p>
      )}

      <div className="flex justify-end gap-2 border-t border-rule pt-3">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-quiet">
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
