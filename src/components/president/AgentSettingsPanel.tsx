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
import {
  AGENT_DEFAULT_NAME,
  agentNameMemoryText,
  isValidAgentName,
  resolveAgentName,
  findAgentNameMemory,
  AGENT_NAME_LIMITS,
} from "@/lib/agent-identity";
import {
  RESPONSE_STYLES,
  DEFAULT_RESPONSE_STYLE,
  responseStyleMemoryText,
  resolveResponseStyle,
  findResponseStyleMemory,
  type ResponseStyle,
} from "@/lib/agent-preferences";
import type { Memory } from "@/lib/chat-store";

const RESPONSE_STYLE_LABELS: Record<ResponseStyle, string> = {
  concise: "Concise",
  balanced: "Balanced",
  detailed: "Detailed",
};

type PendingField = "name" | "style";
interface Pending {
  confirmationId: string;
  field: PendingField;
  kind: "create" | "edit" | "delete";
  preview: string;
}

/**
 * Agent name and response style are both approved workspace preferences,
 * stored as ordinary chat_memories rows (see lib/agent-identity.ts and
 * lib/agent-preferences.ts for the exact text convention) — every change
 * here goes through the same propose-then-confirm functions Memory
 * Manager itself uses. Nothing in this panel writes memory directly, and
 * nothing here is a secret, a model key, or a service-role setting.
 */
export default function AgentSettingsPanel({
  conversationId,
  onClose,
  onOpenMemoryManager,
}: {
  conversationId: string;
  onClose: () => void;
  onOpenMemoryManager: () => void;
}) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listMemories();
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

  const agentName = memories ? resolveAgentName(memories) : AGENT_DEFAULT_NAME;
  const responseStyle = memories ? resolveResponseStyle(memories) : DEFAULT_RESPONSE_STYLE;
  const nameMemory = memories ? findAgentNameMemory(memories) : null;
  const styleMemory = memories ? findResponseStyleMemory(memories) : null;

  async function submitNameChange() {
    const trimmed = nameInput.trim();
    if (!isValidAgentName(trimmed)) {
      setError(`Give the agent a name between ${AGENT_NAME_LIMITS.minLength} and ${AGENT_NAME_LIMITS.maxLength} characters, one line.`);
      return;
    }
    setSaving(true);
    setError(null);
    const text = agentNameMemoryText(trimmed);
    const result = nameMemory
      ? await requestEditMemory(conversationId, nameMemory.id, nameMemory.updatedAt, text, null)
      : await requestCreateMemory(conversationId, text, null);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditingName(false);
    setPending({ confirmationId: result.data.confirmationId, field: "name", kind: nameMemory ? "edit" : "create", preview: trimmed });
  }

  async function submitStyleChange(style: ResponseStyle) {
    if (style === responseStyle) return;
    setSaving(true);
    setError(null);
    const text = responseStyleMemoryText(style);
    const result = styleMemory
      ? await requestEditMemory(conversationId, styleMemory.id, styleMemory.updatedAt, text, null)
      : await requestCreateMemory(conversationId, text, null);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending({ confirmationId: result.data.confirmationId, field: "style", kind: styleMemory ? "edit" : "create", preview: RESPONSE_STYLE_LABELS[style] });
  }

  async function resetField(field: PendingField) {
    const memory = field === "name" ? nameMemory : styleMemory;
    if (!memory) return; // already at default — nothing to reset
    setSaving(true);
    setError(null);
    const label = field === "name" ? "the agent's custom name" : "the response-style preference";
    const result = await requestDeleteMemory(conversationId, memory.id, memory.updatedAt, memory.memoryText);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending({ confirmationId: result.data.confirmationId, field, kind: "delete", preview: label });
  }

  async function confirm() {
    if (!pending) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await confirmMemoryAction(pending.confirmationId);
    setConfirming(false);
    if (!result.ok) {
      setConfirmError(result.error);
      return;
    }
    setPending(null);
    await load();
  }

  async function cancel() {
    if (!pending) return;
    await cancelMemoryAction(pending.confirmationId);
    setPending(null);
    setConfirmError(null);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agent settings"
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/35 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <div className="paper max-h-[90vh] w-full max-w-md overflow-y-auto rounded-b-none sm:rounded-[16px]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-rule bg-white px-5 py-3.5">
          <div>
            <p className="eyebrow">Agent settings</p>
            <h2 className="text-lg font-bold text-navy">Preferences</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-quiet">Close</button>
        </div>

        <div className="space-y-5 p-5">
          <p className="text-[12.5px] leading-relaxed text-navy-soft">
            Shared by both co-presidents. A change here proposes a memory update — nothing takes
            effect until you confirm it below, same as anywhere else in the workspace.
          </p>

          {error && <p role="alert" className="text-[12.5px] font-medium text-rose-800">{error}</p>}

          {pending && (
            <div className="rounded-[12px] border-[1.5px] border-accent/45 bg-accent-wash p-4">
              <p className="text-[12px] font-bold uppercase tracking-wide text-accent-ink">
                Confirm {pending.kind === "delete" ? "reset" : pending.field === "name" ? "agent rename" : "style change"}
              </p>
              <p className="mt-1.5 text-[14px] text-navy">
                {pending.kind === "delete" ? `Reset ${pending.preview} to its default?` : `Set it to "${pending.preview}"?`}
              </p>
              {confirmError && <p role="alert" className="mt-2 text-[12.5px] font-medium text-rose-800">{confirmError}</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={cancel} disabled={confirming} className="btn-quiet">Cancel</button>
                <button type="button" onClick={confirm} disabled={confirming} className="btn-primary py-2 text-[13px]">
                  {confirming ? "Confirming…" : "Confirm"}
                </button>
              </div>
            </div>
          )}

          <section>
            <h3 className="text-[13px] font-bold text-navy">Agent name</h3>
            {editingName ? (
              <div className="mt-2 flex gap-2">
                <label className="sr-only" htmlFor="agent-name-input">Agent name</label>
                <input
                  id="agent-name-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={AGENT_NAME_LIMITS.maxLength}
                  disabled={saving}
                  className="field flex-1 text-[13px]"
                  autoFocus
                />
                <button type="button" onClick={() => void submitNameChange()} disabled={saving} className="btn-primary py-2 text-[13px]">
                  Propose
                </button>
                <button type="button" onClick={() => setEditingName(false)} className="btn-quiet py-2 text-[13px]">Cancel</button>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-navy">{agentName}</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNameInput(agentName === AGENT_DEFAULT_NAME ? "" : agentName);
                      setEditingName(true);
                    }}
                    className="btn-quiet px-2.5 py-1.5 text-[12px]"
                  >
                    Rename
                  </button>
                  {nameMemory && (
                    <button type="button" onClick={() => void resetField("name")} className="btn-quiet px-2.5 py-1.5 text-[12px]">
                      Reset
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-navy">Response style</h3>
            <div className="mt-2 flex gap-1.5">
              {RESPONSE_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={responseStyle === style}
                  onClick={() => void submitStyleChange(style)}
                  disabled={saving}
                  className={`rounded-[10px] border px-3 py-2 text-[12.5px] font-medium transition-colors ${
                    responseStyle === style ? "border-accent bg-accent text-white" : "border-rule bg-white text-navy hover:border-accent/40"
                  }`}
                >
                  {RESPONSE_STYLE_LABELS[style]}
                </button>
              ))}
            </div>
          </section>

          <section className="border-t border-rule pt-4">
            <h3 className="text-[13px] font-bold text-navy">Memory</h3>
            <p className="mt-1 text-[12px] text-navy-soft">
              Meeting day, agenda style, tone, and terminology the agent has been told to remember.
            </p>
            <button type="button" onClick={onOpenMemoryManager} className="btn-quiet mt-2 py-1.5 text-[12.5px]">
              View and manage approved memories
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
