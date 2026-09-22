"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createConversation,
  listConversations,
  openConversation,
  renameConversation,
  deleteConversation,
  listMessages,
} from "@/app/president/chat-actions";
import { sendChatMessage } from "@/app/president/chat-orchestration-actions";
import { listMemories } from "@/app/president/chat-memory-actions";
import { getAgentHomeBriefing } from "@/app/president/agent-home-actions";
import type { AssistantStructured, ChatConversation, ChatMessage } from "@/lib/chat-store";
import type { Suggestion } from "@/lib/types";
import { AGENT_DEFAULT_NAME, AGENT_DESCRIPTION, resolveAgentName } from "@/lib/agent-identity";
import type { AgentHomeBriefing } from "@/lib/agent-home-briefing";
import { TREND_LABEL_TEXT } from "@/lib/trend-radar";
import MemoryManagerPanel from "./MemoryManagerPanel";
import AgentSettingsPanel from "./AgentSettingsPanel";
import MeetingAgent from "./MeetingAgent";
import MeetingHistory from "./MeetingHistory";
import DecisionLog, { type PrefillDecision } from "./DecisionLog";
import ActionItems, { type PrefillAction } from "./ActionItems";
import RecorderCleanupPanel from "./RecorderCleanupPanel";
import TrashPanel from "./TrashPanel";
import HelpPanel from "./HelpPanel";

type ToolPanel = "meeting_prep" | "meeting_history" | "decisions" | "actions" | "recorder" | "trash" | "help" | null;

const STARTER_PROMPTS = [
  "Prepare our next meeting",
  "What needs our attention?",
  "What changed since our last meeting?",
  "Build a proposal from student ideas",
  "Find the biggest student concern",
  "Draft an assembly update",
  "Review unfinished actions",
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
 *
 * Stage 5 connects Meeting Prep, Meeting History, the Decision Log, and
 * Action Items: routing to one of those intents opens the same
 * already-tested component that used to live behind its own tab, as a
 * modal panel (the same pattern Memory Manager already uses). Every
 * create/edit/delete inside those panels still goes through their own
 * existing session-checked, RLS-enforced server actions and still
 * requires the president to review a form and click an explicit
 * save/delete button — chat only opens the door, it never fills in or
 * submits anything on the president's behalf.
 */
export default function AIChat({
  configured,
  suggestions,
  onOpenSuggestion,
}: {
  configured: boolean;
  suggestions: Suggestion[];
  onOpenSuggestion: (id: string) => void;
}) {
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
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const [decisionPrefill, setDecisionPrefill] = useState<PrefillDecision | null>(null);
  const [actionPrefill, setActionPrefill] = useState<PrefillAction | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Both co-presidents see the same name because it's read from the shared
  // chat_memories table (see lib/agent-identity.ts) — nothing here writes
  // it; a rename only ever happens through Agent Settings' existing
  // propose/confirm flow.
  const [agentName, setAgentName] = useState(AGENT_DEFAULT_NAME);
  const [homeBriefing, setHomeBriefing] = useState<AgentHomeBriefing | null>(null);
  const [homeBriefingError, setHomeBriefingError] = useState<string | null>(null);

  useEffect(() => {
    void listMemories().then((result) => {
      if (result.ok) setAgentName(resolveAgentName(result.data));
    });
  }, []);

  useEffect(() => {
    // Zero Groq calls — a handful of count queries, fetched once when the
    // workspace opens, never on an interval and never in the background.
    void getAgentHomeBriefing().then((result) => {
      if (result.ok) setHomeBriefing(result.data);
      else setHomeBriefingError(result.error);
    });
  }, []);

  function addToDecisionLog(prefill: PrefillDecision) {
    setDecisionPrefill(prefill);
    setToolPanel("decisions");
  }
  function addToActionItems(prefill: PrefillAction) {
    setActionPrefill(prefill);
    setToolPanel("actions");
  }

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

    if (result.data.toolStatus === "ok") {
      // meeting_history / list_decisions / list_actions deliberately do NOT
      // open a panel here — Stage 10: a plain read answers inline in the
      // chat itself (see StructuredCard below); the full panel is only a
      // click away on the card itself or the header's quick-access button.
      if (result.data.intent === "memory_manager") setMemoryManagerOpen(true);
      else if (result.data.intent === "meeting_prep") setToolPanel("meeting_prep");
      else if (result.data.intent === "meeting_cleanup") setToolPanel("recorder");
      else if (result.data.intent === "trash") setToolPanel("trash");
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
      <div className="mb-4 overflow-hidden rounded-[16px] border border-violet-300/55 bg-[linear-gradient(135deg,rgba(91,68,181,0.11),rgba(226,78,27,0.07)_55%,rgba(255,255,255,0.75))] px-4 py-4 shadow-[0_12px_35px_-28px_rgba(55,39,120,0.75)] sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3.5">
            <div
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-700 text-xl text-white shadow-sm"
              aria-hidden
            >
              ✦
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="eyebrow text-violet-800">AI Workspace</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100/70 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-900 uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  Ready
                </span>
              </div>
              <h2 className="mt-1 text-xl font-bold text-navy">{agentName}</h2>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-navy-soft">{AGENT_DESCRIPTION}</p>
              <p className="mt-0.5 text-[11px] text-navy-soft/80">An AI assistant, not a human president. Nothing saves without your review.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            className="btn-quiet shrink-0 lg:hidden"
            aria-expanded={sidebarOpen}
            aria-controls="chat-conversation-drawer"
          >
            {sidebarOpen ? "Hide conversations" : "Conversations"}
          </button>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-1.5 border-t border-violet-300/40 pt-3.5">
          <button type="button" onClick={() => setToolPanel("meeting_history")} className="btn-quiet bg-white/70 py-1.5 text-[12.5px]">
            Meeting history
          </button>
          <button type="button" onClick={() => setToolPanel("decisions")} className="btn-quiet bg-white/70 py-1.5 text-[12.5px]">
            Decisions
          </button>
          <button type="button" onClick={() => setToolPanel("actions")} className="btn-quiet bg-white/70 py-1.5 text-[12.5px]">
            Actions
          </button>
          <button type="button" onClick={() => setToolPanel("recorder")} className="btn-quiet bg-white/70 py-1.5 text-[12.5px]">
            Record meeting
          </button>
          <button type="button" onClick={() => setToolPanel("trash")} className="btn-quiet bg-white/70 py-1.5 text-[12.5px]">
            Trash
          </button>
          <button type="button" onClick={() => setToolPanel("help")} className="btn-quiet bg-white/70 py-1.5 text-[12.5px]">
            Help
          </button>
          <button
            type="button"
            onClick={() => void ensureConversation().then((id) => id && setMemoryManagerOpen(true))}
            className="btn-quiet bg-white/70 py-1.5 text-[12.5px]"
          >
            Memory manager
          </button>
          <button
            type="button"
            onClick={() => void ensureConversation().then((id) => id && setAgentSettingsOpen(true))}
            className="btn-quiet bg-white/70 py-1.5 text-[12.5px]"
          >
            Agent settings
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
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-700 text-2xl text-white shadow-sm" aria-hidden>
                  ✦
                </div>
                <p className="mt-3 font-display text-lg font-semibold text-navy">Ask {agentName}</p>
                <p className="mt-1.5 max-w-sm text-[13px] text-navy-soft">
                  Try a starter below, or ask anything about the inbox, meetings, decisions, and action items.
                </p>
                {homeBriefing && <HomeBriefingCard briefing={homeBriefing} />}
                {homeBriefingError && <p role="alert" className="mt-3 text-[12px] font-medium text-rose-800">{homeBriefingError}</p>}
                <div className="mt-5 grid w-full max-w-md grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleStarterPrompt(prompt)}
                      className="rounded-[10px] border border-rule bg-paper px-3 py-2 text-left text-[12.5px] font-medium text-navy transition-colors hover:border-accent/40 hover:bg-accent-wash"
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
                  <li key={message.id} className={`flex items-end gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    {message.role === "assistant" && <AssistantAvatar label={agentName} />}
                    <div
                      className={`group rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                        message.structured ? "max-w-[92%]" : "max-w-[82%]"
                      } ${message.role === "user" ? "bg-navy text-white" : "border border-rule bg-paper text-navy"}`}
                    >
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      {message.structured && <StructuredCard structured={message.structured} onOpenPanel={setToolPanel} />}
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
                  <li className="flex items-end justify-start gap-2">
                    <AssistantAvatar pulse label={agentName} />
                    <div className="flex items-center gap-1.5 rounded-[14px] border border-rule bg-paper px-3.5 py-3 text-[13px] text-navy-soft">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 motion-reduce:animate-none [animation-delay:-0.3s]" aria-hidden />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 motion-reduce:animate-none [animation-delay:-0.15s]" aria-hidden />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 motion-reduce:animate-none" aria-hidden />
                      <span className="sr-only">{agentName} is thinking…</span>
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
            <div className="flex items-end gap-2 rounded-[16px] border border-rule bg-paper-deep/40 p-1.5 pl-3.5 focus-within:border-accent/50">
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
                className="flex-1 resize-none bg-transparent py-2 text-[13.5px] text-navy placeholder:text-navy-soft/70 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !composerText.trim()}
                aria-label="Send"
                className="btn-primary grid h-9 w-9 shrink-0 place-items-center rounded-full p-0 text-base"
              >
                ➤
              </button>
            </div>
          </form>
        </div>
      </div>

      <div ref={liveRegionRef} role="status" aria-live="polite" className="sr-only" />

      {memoryManagerOpen && selectedId && (
        <MemoryManagerPanel conversationId={selectedId} onClose={() => setMemoryManagerOpen(false)} />
      )}

      {agentSettingsOpen && selectedId && (
        <AgentSettingsPanel
          conversationId={selectedId}
          onClose={() => {
            setAgentSettingsOpen(false);
            void listMemories().then((result) => {
              if (result.ok) setAgentName(resolveAgentName(result.data));
            });
          }}
          onOpenMemoryManager={() => {
            setAgentSettingsOpen(false);
            setMemoryManagerOpen(true);
          }}
        />
      )}

      {toolPanel && (
        <ToolPanelModal title={TOOL_PANEL_TITLES[toolPanel]} onClose={() => setToolPanel(null)}>
          {toolPanel === "meeting_prep" && (
            <MeetingAgent
              configured={configured}
              onSaved={() => setHistoryRefresh((n) => n + 1)}
              onViewHistory={() => setToolPanel("meeting_history")}
              onAddDecision={addToDecisionLog}
              onAddAction={addToActionItems}
            />
          )}
          {toolPanel === "meeting_history" && (
            <MeetingHistory refreshSignal={historyRefresh} onAddDecision={addToDecisionLog} onAddAction={addToActionItems} />
          )}
          {toolPanel === "decisions" && (
            <DecisionLog
              suggestions={suggestions}
              onOpenSuggestion={onOpenSuggestion}
              prefill={decisionPrefill}
              onPrefillConsumed={() => setDecisionPrefill(null)}
            />
          )}
          {toolPanel === "actions" && (
            <ActionItems
              suggestions={suggestions}
              onOpenSuggestion={onOpenSuggestion}
              prefill={actionPrefill}
              onPrefillConsumed={() => setActionPrefill(null)}
            />
          )}
          {toolPanel === "recorder" && (
            <RecorderCleanupPanel
              onAddDecision={addToDecisionLog}
              onAddAction={addToActionItems}
              onClose={() => setToolPanel(null)}
            />
          )}
          {toolPanel === "trash" && <TrashPanel onClose={() => setToolPanel(null)} onOpenHelp={() => setToolPanel("help")} />}
          {toolPanel === "help" && <HelpPanel />}
        </ToolPanelModal>
      )}
    </section>
  );
}

/**
 * Dispatches to the right inline card by `structured.type`. Every branch
 * here is purely presentational — the data already arrived validated
 * against assistantStructuredSchema (chat-store.ts) before it reached the
 * browser, so this never re-fetches, re-validates, or trusts anything
 * beyond what that schema already guarantees.
 */
function StructuredCard({ structured, onOpenPanel }: { structured: AssistantStructured; onOpenPanel: (panel: Exclude<ToolPanel, null>) => void }) {
  switch (structured.type) {
    case "since_last_meeting_report":
      return <SinceLastMeetingCard report={structured} />;
    case "inbox_search_results":
      return <InboxSearchCard result={structured} />;
    case "inbox_answer":
      return <CitationListCard label="Sources" citations={structured.citations} />;
    case "trend_radar_report":
      return <TrendRadarCard report={structured} />;
    case "promise_tracker_report":
      return <PromiseTrackerCard report={structured} />;
    case "proposal_draft":
      return <CitationListCard label="Sources" citations={structured.citations} />;
    case "communication_draft":
      return <CitationListCard label="Sources" citations={structured.citations} />;
    case "meeting_history_summary":
      return <MeetingHistorySummaryCard summary={structured} onOpenPanel={onOpenPanel} />;
    case "decisions_summary":
      return <DecisionsSummaryCard summary={structured} onOpenPanel={onOpenPanel} />;
    case "actions_summary":
      return <ActionsSummaryCard summary={structured} onOpenPanel={onOpenPanel} />;
    case "agent_turn":
      return <AgentTurnCard turn={structured} onOpenPanel={onOpenPanel} />;
    default:
      return null;
  }
}

const AGENT_STEP_STATUS_LABEL: Record<string, string> = { done: "Done", failed: "Couldn't complete", skipped: "Skipped" };

function AgentTurnCard({
  turn,
  onOpenPanel,
}: {
  turn: Extract<AssistantStructured, { type: "agent_turn" }>;
  onOpenPanel: (panel: Exclude<ToolPanel, null>) => void;
}) {
  return (
    <div className="mt-2.5 space-y-3 rounded-[10px] border border-rule bg-white/70 p-3">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-navy-soft">Plan</p>
        <ol className="space-y-1 text-[12.5px] text-navy">
          {turn.plan.map((step) => (
            <li key={step.step} className="flex items-center justify-between gap-2">
              <span className="truncate">{step.step}. {step.label}</span>
              <span
                className={`shrink-0 text-[11px] font-semibold ${
                  step.status === "done" ? "text-emerald-700" : step.status === "failed" ? "text-rose-700" : "text-navy-soft"
                }`}
              >
                {AGENT_STEP_STATUS_LABEL[step.status]}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {turn.citations.length > 0 && <CitationListCard label="Sources" citations={turn.citations} />}

      {turn.openPanel === "meeting_prep" && (
        <OpenFullViewButton onClick={() => onOpenPanel("meeting_prep")} label="Open Meeting Prep" />
      )}
    </div>
  );
}

function OpenFullViewButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="mt-2 text-[11.5px] font-semibold text-accent-ink underline">
      {label}
    </button>
  );
}

function MeetingHistorySummaryCard({
  summary,
  onOpenPanel,
}: {
  summary: Extract<AssistantStructured, { type: "meeting_history_summary" }>;
  onOpenPanel: (panel: Exclude<ToolPanel, null>) => void;
}) {
  return (
    <div className="mt-2.5 rounded-[10px] border border-rule bg-white/70 p-3">
      {summary.items.length > 0 && (
        <ul className="space-y-1.5 text-[12.5px] text-navy">
          {summary.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{item.headline}</span>
              <span className="shrink-0 text-[11px] capitalize text-navy-soft">{item.state}</span>
            </li>
          ))}
        </ul>
      )}
      <OpenFullViewButton onClick={() => onOpenPanel("meeting_history")} label="Open full meeting history" />
    </div>
  );
}

function DecisionsSummaryCard({
  summary,
  onOpenPanel,
}: {
  summary: Extract<AssistantStructured, { type: "decisions_summary" }>;
  onOpenPanel: (panel: Exclude<ToolPanel, null>) => void;
}) {
  return (
    <div className="mt-2.5 rounded-[10px] border border-rule bg-white/70 p-3">
      {summary.items.length > 0 && (
        <ul className="space-y-1.5 text-[12.5px] text-navy">
          {summary.items.map((item) => (
            <li key={item.id} className="truncate">{item.decisionText}</li>
          ))}
        </ul>
      )}
      <OpenFullViewButton onClick={() => onOpenPanel("decisions")} label="Open full decision log" />
    </div>
  );
}

function ActionsSummaryCard({
  summary,
  onOpenPanel,
}: {
  summary: Extract<AssistantStructured, { type: "actions_summary" }>;
  onOpenPanel: (panel: Exclude<ToolPanel, null>) => void;
}) {
  return (
    <div className="mt-2.5 rounded-[10px] border border-rule bg-white/70 p-3">
      {summary.items.length > 0 && (
        <ul className="space-y-1.5 text-[12.5px] text-navy">
          {summary.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{item.actionText}</span>
              <span className="shrink-0 text-[11px] text-navy-soft">{item.completed ? "Done" : item.deadline ? `Due ${item.deadline}` : "Open"}</span>
            </li>
          ))}
        </ul>
      )}
      <OpenFullViewButton onClick={() => onOpenPanel("actions")} label="Open full action items" />
    </div>
  );
}

function CitationListCard({ label, citations }: { label: string; citations: Array<{ ref: string; title: string }> }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2.5 rounded-[10px] border border-rule bg-white/70 p-3">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-navy-soft">{label}</p>
      <ul className="space-y-1 text-[12.5px] text-navy">
        {citations.map((c) => (
          <li key={c.ref} className="truncate">
            <span className="mr-1.5 text-[10.5px] font-bold text-navy-soft">{c.ref}</span>
            {c.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InboxSearchCard({ result }: { result: Extract<AssistantStructured, { type: "inbox_search_results" }> }) {
  if (result.hits.length === 0) return null;
  return (
    <div className="mt-2.5 rounded-[10px] border border-rule bg-white/70 p-3">
      <ul className="space-y-1.5 text-[12.5px] text-navy">
        {result.hits.map((hit) => (
          <li key={hit.ref} className="flex items-center justify-between gap-2">
            <span className="truncate">
              <span className="mr-1.5 text-[10.5px] font-bold text-navy-soft">{hit.ref}</span>
              {hit.title}
            </span>
            <span className="shrink-0 text-[11px] text-navy-soft">{STATUS_LABELS[hit.status] ?? hit.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendRadarCard({ report }: { report: Extract<AssistantStructured, { type: "trend_radar_report" }> }) {
  const notable = report.trends.filter((t) => t.label !== "insufficient_evidence");
  if (notable.length === 0) return null;
  return (
    <div className="mt-2.5 rounded-[10px] border border-rule bg-white/70 p-3">
      <ul className="space-y-1.5 text-[12.5px] text-navy">
        {notable.map((t) => (
          <li key={t.category} className="flex items-center justify-between gap-2">
            <span className="truncate capitalize">
              {t.category.replace(/_/g, " ")}
              <span className="ml-1.5 rounded-full border border-rule bg-paper px-1.5 py-0.5 text-[10px] font-semibold text-navy-soft">
                {TREND_LABEL_TEXT[t.label]}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-navy-soft">
              {t.priorCount} → {t.recentCount}
              {t.changeRatio !== null ? ` (${t.changeRatio}×)` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PromiseTrackerCard({ report }: { report: Extract<AssistantStructured, { type: "promise_tracker_report" }> }) {
  const totalGaps = report.gaps.length + report.suggestionGaps.length + report.staleActionGaps.length;
  if (totalGaps === 0) return null;
  return (
    <div className="mt-2.5 space-y-2.5 rounded-[10px] border border-rule bg-white/70 p-3">
      {report.gaps.length > 0 && (
        <ReportSection title={`Decisions with no follow-up action (${report.gaps.length})`}>
          {report.gaps.map((gap) => (
            <li key={gap.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{gap.decisionText}</span>
              <span className="shrink-0 text-[11px] text-navy-soft">{gap.daysSinceDecision}d</span>
            </li>
          ))}
        </ReportSection>
      )}
      {report.suggestionGaps.length > 0 && (
        <ReportSection title={`Approved suggestions with no linked action (${report.suggestionGaps.length})`}>
          {report.suggestionGaps.map((gap) => (
            <li key={gap.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{gap.title}</span>
              <span className="shrink-0 text-[11px] text-navy-soft">{gap.daysSinceCreated}d</span>
            </li>
          ))}
        </ReportSection>
      )}
      {report.staleActionGaps.length > 0 && (
        <ReportSection title={`Open actions untouched since creation (${report.staleActionGaps.length})`}>
          {report.staleActionGaps.map((gap) => (
            <li key={gap.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{gap.actionText}</span>
              <span className="shrink-0 text-[11px] text-navy-soft">{gap.daysSinceCreated}d</span>
            </li>
          ))}
        </ReportSection>
      )}
    </div>
  );
}

function AssistantAvatar({ pulse = false, label }: { pulse?: boolean; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-700 text-[13px] text-white shadow-sm ${pulse ? "motion-safe:animate-pulse" : ""}`}
    >
      <span aria-hidden>✦</span>
    </div>
  );
}

/**
 * The deterministic home briefing (Section 5 of the agent upgrade): zero
 * Groq calls, fetched once via getAgentHomeBriefing — six plain counts
 * read directly from the database, nothing computed or guessed by a
 * model.
 */
function HomeBriefingCard({ briefing }: { briefing: AgentHomeBriefing }) {
  const stats: Array<[string, number]> = [
    ["Unread", briefing.unreadCount],
    ["Duplicate review", briefing.duplicateReviewCount],
    ["Open actions", briefing.openActionCount],
    ["Overdue actions", briefing.overdueActionCount],
    ["Awaiting review 7+ days", briefing.staleSuggestionCount],
  ];
  return (
    <div className="mt-4 w-full max-w-md rounded-[12px] border border-rule bg-paper-deep/40 p-3.5 text-left">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map(([label, count]) => (
          <div key={label} className="rounded-lg border border-rule bg-paper px-2.5 py-2 text-center">
            <p className="text-[16px] font-bold text-navy">{count}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-navy-soft">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[11.5px] text-navy-soft">
        {briefing.mostRecentMeeting
          ? `Last saved meeting: ${briefing.mostRecentMeeting.headline} (${new Date(briefing.mostRecentMeeting.createdAt).toLocaleDateString()})`
          : "No saved meetings yet."}
      </p>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  discussing: "Discussing",
  approved: "Approved",
  in_progress: "In Progress",
  completed: "Completed",
  declined: "Declined",
  archived: "Archived",
};

/**
 * The Stage 6 "Since Last Meeting" report, rendered as a structured card
 * right inside the chat bubble — no modal, no separate panel. Purely
 * presentational: every count and list already arrived validated from the
 * server (chat-store.ts's sinceLastMeetingReportStructuredSchema), so this
 * component does no fetching and no re-validation of its own.
 */
function SinceLastMeetingCard({ report }: { report: Extract<AssistantStructured, { type: "since_last_meeting_report" }> }) {
  return (
    <div className="mt-2.5 space-y-3 rounded-[10px] border border-rule bg-white/70 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["New suggestions", report.newSuggestionCount],
          ["Status changes", report.statusChangeCount],
          ["New decisions", report.newDecisionCount],
          ["New actions", report.newActionCount],
        ].map(([label, count]) => (
          <div key={label as string} className="rounded-lg border border-rule bg-paper px-2.5 py-2 text-center">
            <p className="text-[17px] font-bold text-navy">{count}</p>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-navy-soft">{label}</p>
          </div>
        ))}
      </div>

      {report.newSuggestions.length > 0 && (
        <ReportSection title={`New suggestions (${report.newSuggestionCount})`}>
          {report.newSuggestions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{s.title}</span>
              <span className="shrink-0 text-[11px] text-navy-soft">{STATUS_LABELS[s.status] ?? s.status}</span>
            </li>
          ))}
        </ReportSection>
      )}

      {report.statusChanges.length > 0 && (
        <ReportSection title={`Status changes (${report.statusChangeCount})`}>
          {report.statusChanges.map((c, i) => (
            <li key={`${c.suggestionId}-${i}`} className="flex items-center justify-between gap-2">
              <span className="truncate">{c.title}</span>
              <span className="shrink-0 text-[11px] text-navy-soft">
                {c.fromStatus ? `${STATUS_LABELS[c.fromStatus] ?? c.fromStatus} → ` : ""}
                {STATUS_LABELS[c.toStatus] ?? c.toStatus}
              </span>
            </li>
          ))}
        </ReportSection>
      )}

      {report.newDecisions.length > 0 && (
        <ReportSection title={`New decisions (${report.newDecisionCount})`}>
          {report.newDecisions.map((d) => (
            <li key={d.id} className="truncate">{d.decisionText}</li>
          ))}
        </ReportSection>
      )}

      {report.newActions.length > 0 && (
        <ReportSection title={`New action items (${report.newActionCount})`}>
          {report.newActions.map((a) => (
            <li key={a.id} className="truncate">{a.actionText}</li>
          ))}
        </ReportSection>
      )}
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-navy-soft">{title}</p>
      <ul className="space-y-1 text-[12.5px] text-navy">{children}</ul>
    </div>
  );
}

const TOOL_PANEL_TITLES: Record<Exclude<ToolPanel, null>, string> = {
  meeting_prep: "Meeting prep",
  meeting_history: "Meeting history",
  decisions: "Decision log",
  actions: "Action items",
  recorder: "Record & clean up a meeting",
  trash: "Trash",
  help: "Help & guide",
};

/**
 * Shared modal chrome for the four workspace tools above, matching the
 * dialog pattern MemoryManagerPanel and the old MeetingHistory detail
 * panel already use (role="dialog", overlay, sticky header). Wider than
 * MemoryManagerPanel since these render tables/forms, not a short list.
 */
function ToolPanelModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/35 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <div className="paper max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-b-none sm:rounded-[16px]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-rule bg-white px-5 py-3.5">
          <h2 className="text-lg font-bold text-navy">{title}</h2>
          <button type="button" onClick={onClose} className="btn-quiet">
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
