"use client";

import { useCallback, useEffect, useState } from "react";
import {
  confirmPermanentDeletion,
  getDeletionDependencyPreview,
  listTrash,
  requestPermanentDeletion,
  restoreFromTrash,
  type DeletionDependencyPreview,
} from "@/app/president/trash-actions";
import { confirmationPhraseFor } from "@/lib/trash";
import { CATEGORY_LABELS, STATUS_LABELS, type TrashedSuggestion } from "@/lib/types";
import { LocalTime } from "./ui";

type Stage =
  | { step: "closed" }
  | { step: "preview"; suggestion: TrashedSuggestion; preview: DeletionDependencyPreview | null; loading: boolean }
  | { step: "token"; suggestion: TrashedSuggestion; token: string; error: string | null; busy: boolean };

/**
 * Trash is reached only from here (or from a suggestion's own "Move to
 * Trash" button in SuggestionDetail) — nothing in this panel can create a
 * trashed suggestion, only list, restore, or permanently delete one that
 * already is. Every mutation is a thin call into trash-actions.ts, which
 * itself only ever calls the SECURITY DEFINER database functions — this
 * component never touches the suggestions table directly.
 *
 * Permanent deletion is two confirmations, not one: a typed phrase
 * (checked server-side, not just here) gates requesting a one-time token,
 * and a second, separate button click consumes that token. Either step
 * can be cancelled with nothing deleted.
 */
export default function TrashPanel({ onClose }: { onClose?: () => void }) {
  const [items, setItems] = useState<TrashedSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ step: "closed" });

  const load = useCallback(async () => {
    const result = await listTrash();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setItems(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRestore(id: string) {
    setBusyId(id);
    const result = await restoreFromTrash(id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (stage.step !== "closed" && stage.suggestion.id === id) setStage({ step: "closed" });
    await load();
  }

  async function startDeletionPreview(suggestion: TrashedSuggestion) {
    setStage({ step: "preview", suggestion, preview: null, loading: true });
    const result = await getDeletionDependencyPreview(suggestion.id);
    if (!result.ok) {
      setError(result.error);
      setStage({ step: "closed" });
      return;
    }
    setError(null);
    setStage({ step: "preview", suggestion, preview: result.data, loading: false });
  }

  async function requestToken(suggestion: TrashedSuggestion, typedPhrase: string) {
    const result = await requestPermanentDeletion(suggestion.id, typedPhrase);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setStage({ step: "token", suggestion, token: result.data.token, error: null, busy: false });
  }

  async function finishDeletion(suggestion: TrashedSuggestion, token: string) {
    setStage({ step: "token", suggestion, token, error: null, busy: true });
    const result = await confirmPermanentDeletion(token);
    if (!result.ok) {
      setStage({ step: "token", suggestion, token, error: result.error, busy: false });
      return;
    }
    setStage({ step: "closed" });
    await load();
  }

  return (
    <div className="paper p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Trash</h2>
          <p className="mt-1 text-[12.5px] text-navy-soft">
            Moved here first, recoverable at any time — nothing is permanently deleted until you confirm it twice.
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="btn-quiet">
            Close
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-[12.5px] text-rose-700">{error}</p>}

      <div className="mt-4 space-y-2.5">
        {items === null ? (
          <p className="text-sm text-navy-soft">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-rule px-4 py-8 text-center text-sm text-navy-soft">
            Trash is empty.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-[10px] border border-rule bg-white/70 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-navy-soft">
                    {CATEGORY_LABELS[item.category]} · was {STATUS_LABELS[item.status]}
                  </p>
                  <p className="mt-0.5 truncate text-[14.5px] font-semibold text-navy">{item.title}</p>
                  <p className="mt-1 text-[11.5px] text-navy-soft">
                    Trashed <LocalTime iso={item.trashed_at} /> by {item.trashed_by ?? "unknown"}
                    {item.trash_reason ? ` — "${item.trash_reason}"` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRestore(item.id)}
                    disabled={busyId === item.id}
                    className="btn-quiet"
                  >
                    {busyId === item.id ? "Restoring…" : "Restore"}
                  </button>
                  <button type="button" onClick={() => void startDeletionPreview(item)} className="btn-quiet border-rose-300 text-rose-800">
                    Permanently delete…
                  </button>
                </div>
              </div>

              {stage.step !== "closed" && stage.suggestion.id === item.id && (
                <DeletionFlow stage={stage} onCancel={() => setStage({ step: "closed" })} onRequestToken={requestToken} onFinish={finishDeletion} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DeletionFlow({
  stage,
  onCancel,
  onRequestToken,
  onFinish,
}: {
  stage: Exclude<Stage, { step: "closed" }>;
  onCancel: () => void;
  onRequestToken: (suggestion: TrashedSuggestion, typedPhrase: string) => void;
  onFinish: (suggestion: TrashedSuggestion, token: string) => void;
}) {
  const [typedPhrase, setTypedPhrase] = useState("");

  if (stage.step === "preview") {
    const expected = confirmationPhraseFor(stage.suggestion.id);
    return (
      <div className="mt-3 rounded-[8px] border border-rose-200 bg-rose-50/60 p-3">
        {stage.loading ? (
          <p className="text-[12.5px] text-navy-soft">Checking what else would be removed…</p>
        ) : (
          <>
            <p className="text-[12.5px] font-semibold text-rose-900">Permanently deleting this suggestion also removes:</p>
            <ul className="mt-1.5 list-disc pl-5 text-[12.5px] text-navy-soft">
              <li>{stage.preview?.noteCount ?? 0} internal note{stage.preview?.noteCount === 1 ? "" : "s"}</li>
              <li>{stage.preview?.historyCount ?? 0} status history entr{stage.preview?.historyCount === 1 ? "y" : "ies"}</li>
              <li>{stage.preview?.matchCount ?? 0} duplicate relationship{stage.preview?.matchCount === 1 ? "" : "s"}</li>
              <li>{stage.preview?.citationCount ?? 0} meeting citation{stage.preview?.citationCount === 1 ? "" : "s"}</li>
            </ul>
            <p className="mt-2 text-[12.5px] text-navy-soft">This cannot be undone.</p>

            <label className="mt-3 block text-[12.5px] font-semibold text-rose-900">
              Type <code className="rounded bg-white px-1 py-0.5">{expected}</code> to continue:
            </label>
            <input
              type="text"
              value={typedPhrase}
              onChange={(e) => setTypedPhrase(e.target.value)}
              className="mt-1.5 w-full max-w-xs rounded-[8px] border border-rule px-2.5 py-1.5 text-[13px]"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                className="btn-quiet border-rose-300 text-rose-800"
                disabled={typedPhrase.trim() !== expected}
                onClick={() => onRequestToken(stage.suggestion, typedPhrase)}
              >
                Continue
              </button>
              <button type="button" onClick={onCancel} className="btn-quiet">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-[8px] border border-rose-300 bg-rose-50 p-3">
      <p className="text-[12.5px] font-semibold text-rose-900">
        Last step — this permanently deletes the suggestion and everything listed above. There is no undo.
      </p>
      {stage.error && <p className="mt-1.5 text-[12px] text-rose-700">{stage.error}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          className="btn-quiet border-rose-400 bg-rose-100 text-rose-900"
          disabled={stage.busy}
          onClick={() => onFinish(stage.suggestion, stage.token)}
        >
          {stage.busy ? "Deleting…" : "Confirm permanent deletion"}
        </button>
        <button type="button" onClick={onCancel} className="btn-quiet" disabled={stage.busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
