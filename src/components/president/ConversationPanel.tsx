"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getConversation,
  markConversationReadByPresident,
  reopenConversation,
  resolveConversation,
  sendPresidentMessage,
} from "@/app/president/conversation-actions";
import { draftConversationReply } from "@/app/president/conversation-ai-actions";
import type { ConversationDraftMode } from "@/lib/conversation-ai-prompt";
import type { ConversationState, PresidentConversationMessage } from "@/lib/types";
import { LocalTime } from "./ui";

const DRAFT_ACTIONS: Array<{ mode: ConversationDraftMode; label: string }> = [
  { mode: "draft", label: "Draft reply" },
  { mode: "warmer", label: "Make warmer" },
  { mode: "shorter", label: "Make shorter" },
  { mode: "clarify", label: "Ask a clarifying question" },
  { mode: "summarize", label: "Summarize thread" },
  { mode: "unanswered", label: "Identify unanswered questions" },
];

/**
 * The co-president side of a suggestion's private conversation. Shows
 * full verified authorship (via list_president_conversation_messages,
 * which — unlike the student-facing read — includes sender_email) for
 * internal coordination, never sent to the student. Every AI draft
 * button here fills the composer text box only; sending is always a
 * separate, explicit click on Send.
 */
export default function ConversationPanel({
  suggestionId,
  studentName,
  studentEmail,
}: {
  suggestionId: string;
  studentName: string | null;
  studentEmail: string | null;
}) {
  const [state, setState] = useState<ConversationState>("open");
  const [messages, setMessages] = useState<PresidentConversationMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [aiBusy, setAiBusy] = useState<ConversationDraftMode | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const result = await getConversation(suggestionId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setState(result.data.state);
    setMessages(result.data.messages);
  }, [suggestionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void markConversationReadByPresident(suggestionId);
  }, [suggestionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`president-conversation-${suggestionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggestion_conversations", filter: `suggestion_id=eq.${suggestionId}` },
        () => {
          void load();
          if (liveRegionRef.current) liveRegionRef.current.textContent = "The conversation was updated.";
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [suggestionId, load]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const result = await sendPresidentMessage(suggestionId, body);
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setAiNote(null);
    setDraft("");
    setMessages((prev) => [...(prev ?? []), result.data]);
    void markConversationReadByPresident(suggestionId);
  }

  async function handleResolve() {
    setResolving(true);
    const result = state === "resolved" ? await reopenConversation(suggestionId) : await resolveConversation(suggestionId);
    setResolving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    await load();
  }

  async function handleAiAction(mode: ConversationDraftMode) {
    setAiBusy(mode);
    setAiNote(null);
    const result = await draftConversationReply(suggestionId, mode, draft);
    setAiBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(result.data.draft);
    setAiNote("AI-drafted — review before sending.");
  }

  return (
    <section className="border-b border-rule py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold tracking-wide text-navy-soft uppercase">Student conversation</h3>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              state === "resolved" ? "border-rule bg-paper text-navy-soft" : "border-emerald-300 bg-emerald-50 text-emerald-900"
            }`}
          >
            {state === "resolved" ? "Resolved" : "Open"}
          </span>
          <button type="button" onClick={handleResolve} disabled={resolving} className="btn-quiet py-1 text-[12px]">
            {resolving ? "…" : state === "resolved" ? "Reopen" : "Mark resolved"}
          </button>
        </div>
      </div>

      {(studentName || studentEmail) && (
        <p className="mt-1 text-[12px] text-navy-soft">
          With {studentName || "this student"}
          {studentEmail ? ` (${studentEmail})` : ""}
        </p>
      )}

      <div aria-live="polite" className="sr-only" ref={liveRegionRef} />

      <div className="mt-3 max-h-96 space-y-2.5 overflow-y-auto rounded-[10px] border border-rule bg-paper/60 p-3">
        {messages === null ? (
          <p className="text-[12.5px] text-navy-soft">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-[12.5px] text-navy-soft">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.senderRole === "president" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-[10px] px-3 py-2 text-[13px] leading-relaxed ${
                  m.senderRole === "president" ? "bg-navy text-white" : "border border-rule bg-white text-navy"
                }`}
              >
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide opacity-70">
                  {m.senderRole === "student" ? "Student" : m.senderEmail}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className="mt-1 text-[10px] opacity-60">
                  <LocalTime iso={m.createdAt} />
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mt-2 text-[12.5px] text-rose-700" role="alert">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {DRAFT_ACTIONS.map((action) => (
          <button
            key={action.mode}
            type="button"
            onClick={() => void handleAiAction(action.mode)}
            disabled={aiBusy !== null}
            className="btn-quiet py-1 text-[11.5px]"
          >
            {aiBusy === action.mode ? "Working…" : action.label}
          </button>
        ))}
      </div>
      {aiNote && <p className="mt-1.5 text-[11.5px] font-semibold text-accent-ink">{aiNote}</p>}

      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="sr-only" htmlFor={`president-composer-${suggestionId}`}>
          Reply as Co-Presidents
        </label>
        <textarea
          id={`president-composer-${suggestionId}`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setAiNote(null);
          }}
          maxLength={2000}
          rows={3}
          placeholder="Reply as Co-Presidents…"
          className="field min-h-[60px] flex-1 resize-none text-[13.5px]"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || draft.trim().length === 0}
          className="btn-primary shrink-0 px-5 py-2.5 text-[13.5px]"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </section>
  );
}
