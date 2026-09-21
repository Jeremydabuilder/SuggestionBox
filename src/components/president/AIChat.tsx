"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createConversation,
  listConversations,
  openConversation,
  renameConversation,
  deleteConversation,
  listMessages,
} from "@/app/president/chat-actions";
import { sendChatMessage } from "@/app/president/chat-orchestration-actions";
import type { ChatConversation, ChatMessage } from "@/lib/chat-store";
import MemoryManagerPanel from "./MemoryManagerPanel";

const STARTER_PROMPTS = [
  "Prepare our next meeting",
  "What changed since our last meeting?",
  "What needs attention?",
  "Show open action items",
  "Search student suggestions",
  "Build a proposal",
  "Draft an assembly update",
  "Review meeting history",
  "Manage memory",
  "Help",
];

/**
 * The unified AI Workspace chat. Replaces the old Meeting Prep / Meeting
 * History / Decisions / Action Items tab bar as the AI Workspace's entry
 * point — those components and their server actions are untouched and
 * still work; they're just no longer reachable from AI Workspace
 * navigation until Stage 5 connects their tools into this chat.
 *
 * No token-by-token streaming: there is no SSE pipe wired up in this
 * stage, so faking one would misrepresent what's happening. Instead, a
 * plain "thinking…" state shows honestly while the one server action call
 * is in flight, then swaps to the real result. Same reasoning for "stop
 * generating" — a Server Action call can't be genuinely cancelled from the
 * client once dispatched, so no stop control is shown; showing one would
 * be dishonest UI.
 */
export default function AIChat() {
  const [conversations, setConversations] = useState<ChatConversation[] | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [conversationQuery, setConversationQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [memoryManagerOpen, setMemoryManagerOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async (query?: string) => {
    const result = await listConversations({ query: query || undefined, limit: 50 });
    if (!result.ok) {
      setConversationsError(result.error);
      return;
    }
    setConversationsError(null);
    setConversations(result.data.conversations);
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const result = await listMessages(conversationId, { limit: 200 });
    if (!result.ok) {
      setMessagesError(result.error);
      return;
    }
    setMessagesError(null);
    setMessages(result.data.messages);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages(null);
      return;
    }
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function ensureConversation(): Promise<string | null> {
    if (selectedId) return selectedId;
    const result = await createConversation();
    if (!result.ok) {
      setSendError(result.error);
      return null;
    }
    setSelectedId(result.data.id);
    await loadConversations();
    return result.data.id;
  }

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setSendError(null);
    setLastFailedText(null);

    const conversationId = await ensureConversation();
    if (!conversationId) {
      setSending(false);
      setLastFailedText(trimmed);
      return;
    }

    const result = await sendChatMessage(conversationId, trimmed);
    setSending(false);

    if (!result.ok) {
      setSendError(result.error);
      setLastFailedText(trimmed);
      return;
    }

    setComposerText("");
    setMessages((prev) => [...(prev ?? []), result.data.userMessage, result.data.assistantMessage]);
    if (liveRegionRef.current) liveRegionRef.current.textContent = "New reply received.";
    await loadConversations();

    if (result.data.intent === "memory_manager" && result.data.toolStatus === "ok") {
      setMemoryManagerOpen(true);
    }
  }

  function handleComposerSubmit(event: React.FormEvent) {
    event.preventDefault();
    void handleSend(composerText);
  }

  function handleStarterPrompt(prompt: string) {
    setComposerText(prompt);
    void handleSend(prompt);
  }

  function handleRetry() {
    if (lastFailedText) void handleSend(lastFailedText);
  }

  async function handleNewConversation() {
    const result = await createConversation();
    if (!result.ok) {
      setConversationsError(result.error);
      return;
    }
    setSelectedId(result.data.id);
    setSidebarOpen(false);
    await loadConversations();
  }

  async function handleRenameSubmit(id: string) {
    const result = await renameConversation(id, renameValue);
    if (!result.ok) {
      setConversationsError(result.error);
      return;
    }
    setRenamingId(null);
    await loadConversations();
  }

  async function handleDelete(id: string) {
    const result = await deleteConversation(id);
    if (!result.ok) {
      setConversationsError(result.error);
      return;
    }
    setConfirmingDeleteId(null);
    if (selectedId === id) setSelectedId(null);
    await loadConversations();
  }

  async function handleOpen(id: string) {
    const result = await openConversation(id);
    if (!result.ok) {
      setConversationsError(result.error);
      return;
    }
    setSelectedId(id);
    setSidebarOpen(false);
  }

  function copyMessage(message: ChatMessage) {
    void navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <section className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-violet-800">AI Workspace</p>
          <h2 className="mt-1 text-xl font-bold text-navy">AI Co-President</h2>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            className="btn-quiet lg:hidden"
            aria-expanded={sidebarOpen}
            aria-controls="chat-conversation-drawer"
          >
            {sidebarOpen ? "Hide conversations" : "Conversations"}
          </button>
          <button
            type="button"
            onClick={() => void ensureConversation().then((id) => id && setMemoryManagerOpen(true))}
            className="btn-quiet"
          >
            Memory manager
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* ---- conversation sidebar / mobile drawer ---- */}
        <div
          id="chat-conversation-drawer"
          className={`${sidebarOpen ? "block" : "hidden"} lg:block`}
        >
          <div className="paper flex h-full max-h-[70vh] flex-col p-3 lg:max-h-[640px]">
            <button type="button" onClick={handleNewConversation} className="btn-primary w-full py-2 text-[13px]">
              New conversation
            </button>
            <label htmlFor="conversation-search" className="sr-only">Search conversations</label>
            <input
              id="conversation-search"
              type="search"
              value={conversationQuery}
              onChange={(e) => {
                setConversationQuery(e.target.value);
                void loadConversations(e.target.value);
              }}
              placeholder="Search conversations…"
              className="field mt-2.5 text-[13px]"
            />
            {conversationsError && (
              <p role="alert" className="mt-2 text-[12px] font-medium text-rose-800">{conversationsError}</p>
            )}
            <ul className="mt-2.5 flex-1 space-y-1 overflow-y-auto" aria-label="Recent conversations">
              {conversations === null ? (
                <li className="px-2 py-3 text-[12.5px] text-navy-soft">Loading…</li>
              ) : conversations.length === 0 ? (
                <li className="px-2 py-3 text-[12.5px] text-navy-soft">No conversations yet.</li>
              ) : (
                conversations.map((conversation) => (
                  <li key={conversation.id}>
                    {renamingId === conversation.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleRenameSubmit(conversation.id);
                        }}
                        className="flex gap-1 px-1 py-1"
                      >
                        <label className="sr-only" htmlFor={`rename-${conversation.id}`}>Rename conversation</label>
                        <input
                          id={`rename-${conversation.id}`}
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="field flex-1 py-1 text-[12.5px]"
                        />
                        <button type="submit" className="btn-quiet px-2 py-1 text-[12px]">Save</button>
                        <button type="button" onClick={() => setRenamingId(null)} className="btn-quiet px-2 py-1 text-[12px]">✕</button>
                      </form>
                    ) : (
                      <div
                        className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                          selectedId === conversation.id ? "bg-paper-deep" : "hover:bg-paper-deep/60"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleOpen(conversation.id)}
                          aria-current={selectedId === conversation.id ? "true" : undefined}
                          className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-navy"
                        >
                          {conversation.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(conversation.id);
                            setRenameValue(conversation.title);
                          }}
                          aria-label={`Rename "${conversation.title}"`}
                          className="shrink-0 rounded px-1 text-[11px] text-navy-soft opacity-0 group-hover:opacity-100 hover:text-navy"
                        >
                          Rename
                        </button>
                        {confirmingDeleteId === conversation.id ? (
                          <span className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => void handleDelete(conversation.id)}
                              className="rounded px-1 text-[11px] font-semibold text-rose-800"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              className="rounded px-1 text-[11px] text-navy-soft"
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(conversation.id)}
                            aria-label={`Delete "${conversation.title}"`}
                            className="shrink-0 rounded px-1 text-[11px] text-navy-soft opacity-0 group-hover:opacity-100 hover:text-rose-800"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* ---- chat pane ---- */}
        <div className="paper flex h-full max-h-[70vh] flex-col lg:max-h-[640px]">
          <div className="flex-1 overflow-y-auto p-4 sm:p-5" aria-live="off">
            {!selectedId || !messages || messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <p className="font-display text-lg font-semibold text-navy">Ask your AI Co-President</p>
                <p className="mt-1.5 max-w-sm text-[13px] text-navy-soft">
                  Some tools are still being connected — I&rsquo;ll tell you honestly if something isn&rsquo;t available yet.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleStarterPrompt(prompt)}
                      className="rounded-full border border-rule bg-paper px-3 py-1.5 text-[12.5px] font-medium text-navy hover:border-accent/40 hover:bg-accent-wash"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                {messagesError && <p role="alert" className="mt-3 text-[12.5px] font-medium text-rose-800">{messagesError}</p>}
              </div>
            ) : (
              <ul className="space-y-3">
                {messages.map((message) => (
                  <li key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`group max-w-[85%] rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                        message.role === "user" ? "bg-navy text-white" : "border border-rule bg-paper text-navy"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      {message.role === "assistant" && (
                        <button
                          type="button"
                          onClick={() => copyMessage(message)}
                          className="mt-1.5 text-[11px] font-semibold text-navy-soft opacity-0 transition-opacity group-hover:opacity-100 hover:text-navy"
                        >
                          {copiedId === message.id ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {sending && (
                  <li className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-[14px] border border-rule bg-paper px-3.5 py-2.5 text-[13px] text-navy-soft">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-navy-soft/30 border-t-navy-soft" aria-hidden />
                      Thinking…
                    </div>
                  </li>
                )}
                <div ref={messagesEndRef} />
              </ul>
            )}
          </div>

          {sendError && (
            <div className="border-t border-rose-200 bg-rose-50/80 px-4 py-2.5 sm:px-5">
              <p role="alert" className="text-[13px] font-medium text-rose-800">{sendError}</p>
              {lastFailedText && (
                <button type="button" onClick={handleRetry} className="mt-1 text-[12.5px] font-semibold text-rose-900 underline">
                  Retry
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleComposerSubmit} className="border-t border-rule p-3 sm:p-4">
            <label htmlFor="chat-composer" className="sr-only">Message</label>
            <div className="flex gap-2">
              <textarea
                id="chat-composer"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend(composerText);
                  }
                }}
                disabled={sending}
                rows={1}
                maxLength={4000}
                placeholder="Ask about the inbox, prepare a meeting, manage memory…"
                className="field resize-none text-[13.5px]"
              />
              <button type="submit" disabled={sending || !composerText.trim()} className="btn-primary shrink-0 px-4 text-[13px]">
                Send
              </button>
            </div>
          </form>
        </div>
      </div>

      <div ref={liveRegionRef} role="status" aria-live="polite" className="sr-only" />

      {memoryManagerOpen && selectedId && (
        <MemoryManagerPanel conversationId={selectedId} onClose={() => setMemoryManagerOpen(false)} />
      )}
    </section>
  );
}
