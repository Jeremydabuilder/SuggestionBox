"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listMemories,
  requestCreateMemory,
  requestEditMemory,
  requestDeleteMemory,
  confirmMemoryAction,
  cancelMemoryAction,
} from "@/app/president/chat-memory-actions";
import { MEMORY_CATEGORIES, type Memory, type MemoryCategory } from "@/lib/chat-store";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  meeting_format: "Meeting format",
  terminology: "Terminology",
  tone: "Tone",
  constraint: "Constraint",
  other: "Other",
};

/**
 * Reachable from inside the chat (a header button), not a separate
 * workspace tab. Every create/edit/delete here creates a pending
 * confirmation first — nothing is written to chat_memories until the
 * president clicks Confirm, which is exactly what the Stage 1/2 boundary
 * requires even for a president's own typed text.
 */
export default function MemoryManagerPanel({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<MemoryCategory | "">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // A proposal awaiting the president's explicit Confirm click. Only one at
  // a time in this panel — the confirmation card itself names exactly what
  // will happen; nothing about the click can change what gets applied.
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    confirmationId: string;
    kind: "create" | "edit" | "delete";
    preview: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async (q?: string) => {
    const result = await listMemories(q ? { query: q } : undefined);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setMemories(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreateForm() {
    setEditingMemory(null);
    setText("");
    setCategory("");
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(memory: Memory) {
    setEditingMemory(memory);
    setText(memory.memoryText);
    setCategory(memory.category ?? "");
    setFormError(null);
    setFormOpen(true);
  }

  async function submitProposal() {
    if (!text.trim()) {
      setFormError("Write the memory first.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const result = editingMemory
      ? await requestEditMemory(conversationId, editingMemory.id, editingMemory.updatedAt, text.trim(), category || null)
      : await requestCreateMemory(conversationId, text.trim(), category || null);
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setFormOpen(false);
    setPendingConfirmation({
      confirmationId: result.data.confirmationId,
      kind: editingMemory ? "edit" : "create",
      preview: text.trim(),
    });
  }

  async function proposeDelete(memory: Memory) {
    setConfirmingDeleteId(memory.id);
    const result = await requestDeleteMemory(conversationId, memory.id, memory.updatedAt, memory.memoryText);
    setConfirmingDeleteId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPendingConfirmation({ confirmationId: result.data.confirmationId, kind: "delete", preview: memory.memoryText });
  }

  async function confirm() {
    if (!pendingConfirmation) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await confirmMemoryAction(pendingConfirmation.confirmationId);
    setConfirming(false);
    if (!result.ok) {
      // Covers replay, expiry, and stale-state rejection with the exact
      // messages confirmMemoryAction already maps from the database.
      setConfirmError(result.error);
      return;
    }
    setPendingConfirmation(null);
    await load(query || undefined);
  }

  async function cancel() {
    if (!pendingConfirmation) return;
    await cancelMemoryAction(pendingConfirmation.confirmationId);
    setPendingConfirmation(null);
    setConfirmError(null);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Memory manager"
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/35 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <div className="paper max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-b-none sm:rounded-[16px]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-rule bg-white px-5 py-3.5">
          <div>
            <p className="eyebrow">Shared workspace memory</p>
            <h2 className="text-lg font-bold text-navy">Memory manager</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-quiet">
            Close
          </button>
        </div>

        <div className="p-5">
          <p className="mb-4 text-[12.5px] leading-relaxed text-navy-soft">
            Stable facts the AI can use in future conversations — a meeting day, a preferred format, a tone note.
            Both co-presidents share this list. Nothing is saved here without an explicit Confirm, even something
            you type yourself.
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="memory-search">Search memories</label>
            <input
              id="memory-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                void load(e.target.value || undefined);
              }}
              placeholder="Search memories…"
              className="field flex-1 text-[13px]"
            />
            <button type="button" onClick={openCreateForm} className="btn-primary py-2 text-[13px]">
              Add memory
            </button>
          </div>

          {error && <p role="alert" className="mb-3 text-[13px] font-medium text-rose-800">{error}</p>}

          {pendingConfirmation && (
            <div className="mb-4 rounded-[12px] border-[1.5px] border-accent/45 bg-accent-wash p-4">
              <p className="text-[12px] font-bold uppercase tracking-wide text-accent-ink">
                Confirm {pendingConfirmation.kind === "create" ? "new memory" : pendingConfirmation.kind === "edit" ? "memory edit" : "memory deletion"}
              </p>
              <p className="mt-1.5 text-[14px] text-navy">
                {pendingConfirmation.kind === "delete" ? "Forget: " : pendingConfirmation.kind === "edit" ? "Change to: " : "Remember: "}
                &ldquo;{pendingConfirmation.preview}&rdquo;
              </p>
              {confirmError && <p role="alert" className="mt-2 text-[12.5px] font-medium text-rose-800">{confirmError}</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={cancel} disabled={confirming} className="btn-quiet">
                  Cancel
                </button>
                <button type="button" onClick={confirm} disabled={confirming} className="btn-primary py-2 text-[13px]">
                  {confirming ? "Confirming…" : "Confirm"}
                </button>
              </div>
            </div>
          )}

          {formOpen && (
            <div className="mb-4 rounded-[12px] border border-rule bg-paper-deep/50 p-4">
              <label htmlFor="memory-text" className="text-sm font-semibold text-navy">
                {editingMemory ? "Edit memory" : "New memory"}
              </label>
              <textarea
                id="memory-text"
                className="field mt-1.5 resize-y text-[13.5px]"
                rows={2}
                maxLength={500}
                value={text}
                disabled={saving}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Weekly meeting is Fridays at 3pm"
              />
              <label htmlFor="memory-category" className="mt-3 block text-sm font-semibold text-navy">
                Category (optional)
              </label>
              <select
                id="memory-category"
                className="field mt-1.5 cursor-pointer text-[13.5px]"
                value={category}
                disabled={saving}
                onChange={(e) => setCategory(e.target.value as MemoryCategory | "")}
              >
                <option value="">No category</option>
                {MEMORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
              {formError && <p role="alert" className="mt-2 text-[12.5px] font-medium text-rose-800">{formError}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="btn-quiet">
                  Cancel
                </button>
                <button type="button" onClick={submitProposal} disabled={saving} className="btn-primary py-2 text-[13px]">
                  {saving ? "Proposing…" : "Propose"}
                </button>
              </div>
            </div>
          )}

          {!memories ? (
            <p className="text-[13px] text-navy-soft">Loading memories…</p>
          ) : memories.length === 0 ? (
            <p className="rounded-xl border border-rule bg-paper px-3 py-6 text-center text-[13px] text-navy-soft">
              Nothing remembered yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {memories.map((memory) => (
                <li key={memory.id} className="rounded-xl border border-rule bg-paper px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] leading-relaxed text-navy">{memory.memoryText}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-navy-soft">
                        {memory.category && (
                          <span className="rounded-full border border-rule bg-white px-2 py-0.5 font-semibold">
                            {CATEGORY_LABELS[memory.category]}
                          </span>
                        )}
                        <span>
                          Added by {memory.createdBy} · {new Date(memory.createdAt).toLocaleDateString()}
                          {memory.updatedAt !== memory.createdAt && ` · edited by ${memory.updatedBy}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => openEditForm(memory)} className="btn-quiet px-2.5 py-1.5 text-[12px]">
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => proposeDelete(memory)}
                        disabled={confirmingDeleteId === memory.id}
                        className="btn-quiet px-2.5 py-1.5 text-[12px]"
                      >
                        {confirmingDeleteId === memory.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
