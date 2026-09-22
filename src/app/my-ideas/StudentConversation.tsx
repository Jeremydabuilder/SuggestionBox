"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getMyConversation, markMyConversationRead, sendMyMessage } from "./conversation-actions";
import type { ConversationState, StudentConversationMessage } from "@/lib/types";

/**
 * The student side of a suggestion's private conversation. Read-only
 * history plus a single-line-friendly composer — nothing here ever shows
 * which individual co-president wrote a reply, because the data it reads
 * (list_my_conversation_messages, via getMyConversation) never carries
 * that column in the first place; there is nothing to accidentally
 * render.
 */
export default function StudentConversation({ suggestionId }: { suggestionId: string }) {
  const [state, setState] = useState<ConversationState>("open");
  const [messages, setMessages] = useState<StudentConversationMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const result = await getMyConversation(suggestionId);
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

  // Opening the conversation marks it read, per spec — a plain fire-and-
  // forget call; nothing in the UI depends on its result.
  useEffect(() => {
    void markMyConversationRead(suggestionId);
  }, [suggestionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  // Realtime refresh-on-change only — see the migration's own doc comment
  // for why suggestion_messages itself is never subscribed to. A failed
  // subscription just means this quietly falls back to no live updates;
  // the conversation still works on every explicit action (send, reopen
  // on load) and a manual page refresh.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`my-conversation-${suggestionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggestion_conversations", filter: `suggestion_id=eq.${suggestionId}` },
        () => {
          void load();
          if (liveRegionRef.current) liveRegionRef.current.textContent = "New message received.";
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [suggestionId, load]);

  async function handleSend(text: string) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setLastFailedText(null);
    const result = await sendMyMessage(suggestionId, body);
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      setLastFailedText(body);
      return;
    }
    setError(null);
    setDraft("");
    setMessages((prev) => [...(prev ?? []), result.data]);
    void markMyConversationRead(suggestionId);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void handleSend(draft);
  }

  return (
    <div className="mt-4 rounded-[12px] border border-rule bg-white/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-navy">Conversation with the co-presidents</h3>
        {state === "resolved" && (
          <span className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[11px] font-semibold text-navy-soft">Resolved</span>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-navy-soft">
        Use this conversation only to clarify your suggestion. For urgent safety concerns, contact a trusted adult or the
        school directly.
      </p>

      <div aria-live="polite" className="sr-only" ref={liveRegionRef} />

      <div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto rounded-[10px] border border-rule bg-paper/60 p-3">
        {messages === null ? (
          <p className="text-[12.5px] text-navy-soft">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-[12.5px] text-navy-soft">No messages yet — send one to start the conversation.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.senderRole === "student" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-[10px] px-3 py-2 text-[13px] leading-relaxed ${
                  m.senderRole === "student" ? "bg-navy text-white" : "border border-rule bg-white text-navy"
                }`}
              >
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide opacity-70">
                  {m.senderRole === "student" ? "You" : "Co-Presidents"}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className="mt-1 text-[10px] opacity-60">
                  <LocalDateTime iso={m.createdAt} />
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mt-2 text-[12.5px] text-rose-700" role="alert">
          {error}
          {lastFailedText && (
            <button type="button" onClick={() => void handleSend(lastFailedText)} className="ml-2 underline underline-offset-2">
              Retry
            </button>
          )}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="sr-only" htmlFor={`conversation-composer-${suggestionId}`}>
          Write a message
        </label>
        <textarea
          id={`conversation-composer-${suggestionId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Write a message…"
          className="field min-h-[44px] flex-1 resize-none text-[13.5px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend(draft);
            }
          }}
        />
        <button type="submit" disabled={sending || draft.trim().length === 0} className="btn-primary shrink-0 px-5 py-2.5 text-[13.5px]">
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => iso.slice(0, 10));
  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  }, [iso]);
  return <>{text}</>;
}
