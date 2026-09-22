"use server";

import { getPresidentSession } from "@/lib/auth";
import { sendUserMessage, listMessages } from "./chat-actions";
import { routeChatMessage } from "./chat-router";
import { insertAssistantMessage } from "./chat-assistant-internal";
import { getSinceLastMeetingReport } from "./since-last-meeting-actions";
import { searchInbox } from "./inbox-search-actions";
import { getTrendRadar } from "./trend-radar-actions";
import { getPromiseTracker } from "./promise-tracker-actions";
import { answerWorkspaceQuestion } from "./chat-inbox-answer";
import { buildProposalDraft } from "./chat-proposal-builder";
import { buildCommunicationDraft } from "./chat-communication-draft";
import type { ActionResult } from "./actions";
import type { AssistantStructured, ChatMessage } from "@/lib/chat-store";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export interface SendChatMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  intent: string;
  toolStatus: "ok" | "not_available";
}

const RECENT_CONTEXT_MESSAGES = 6;

/**
 * The one browser-callable entry point that turns a typed message into a
 * persisted turn: insert the user's message (via the existing, RLS-
 * enforced sendUserMessage), route it (Stage 3), and persist the
 * assistant's reply through the trusted internal module — never a raw
 * client-controllable insert of an assistant row.
 *
 * Obtains identity from getPresidentSession() itself, exactly as required:
 * nothing here accepts a claimed president identity as an argument.
 */
export async function sendChatMessage(rawConversationId: unknown, rawContent: unknown): Promise<ActionResult<SendChatMessageResult>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const conversationId = typeof rawConversationId === "string" ? rawConversationId : "";

  const userResult = await sendUserMessage(conversationId, rawContent);
  if (!userResult.ok) return userResult;

  // Bounded recent context for pronoun/reference resolution only — capped
  // well below what the classifier itself further bounds (see
  // CLASSIFIER_LIMITS in lib/chat-classifier.ts).
  const historyResult = await listMessages(conversationId, { limit: 200, offset: 0 });
  const priorMessages = historyResult.ok ? historyResult.data.messages.slice(0, -1) : [];
  const recentContext = priorMessages.slice(-RECENT_CONTEXT_MESSAGES).map((m) => m.content);

  const { decision, execution } = await routeChatMessage(session, userResult.data.content, recentContext);

  let assistantContent: string;
  let structured: AssistantStructured | null = null;
  if (execution.status === "ok" && execution.kind === "help") {
    assistantContent = execution.message;
  } else if (execution.status === "ok" && execution.kind === "clarification") {
    assistantContent = execution.question;
  } else if (execution.status === "ok" && execution.kind === "memory_manager") {
    assistantContent = "Opening Memory Manager.";
  } else if (execution.status === "ok" && execution.kind === "meeting_prep") {
    assistantContent = "Opening Meeting Prep.";
  } else if (execution.status === "ok" && execution.kind === "meeting_history") {
    assistantContent = "Opening Meeting History.";
  } else if (execution.status === "ok" && execution.kind === "list_decisions") {
    assistantContent = "Opening the Decision Log.";
  } else if (execution.status === "ok" && execution.kind === "list_actions") {
    assistantContent = "Opening Action Items.";
  } else if (execution.status === "ok" && execution.kind === "since_last_meeting") {
    // Read-only and safe to answer inline — no panel, no confirmation, just
    // a structured card built from a deterministic report (see
    // since-last-meeting-actions.ts: no model call happens anywhere in it).
    const reportResult = await getSinceLastMeetingReport(execution.meetingId ?? undefined);
    if (reportResult.ok) {
      assistantContent = reportResult.data.summary;
      structured = {
        type: "since_last_meeting_report",
        referenceMeetingHeadline: reportResult.data.meetingHeadline,
        ...reportResult.data.report,
      };
    } else {
      assistantContent = reportResult.error;
    }
  } else if (execution.status === "ok" && execution.kind === "search_inbox") {
    const searchResult = await searchInbox(execution.query, execution.category, execution.status_filter);
    if (searchResult.ok) {
      const { hits, totalMatches } = searchResult.data;
      assistantContent =
        totalMatches === 0
          ? "No suggestions matched that search."
          : `Found ${totalMatches} suggestion${totalMatches === 1 ? "" : "s"}${hits.length < totalMatches ? ` (showing ${hits.length})` : ""}.`;
      structured = { type: "inbox_search_results", totalMatches, hits };
    } else {
      assistantContent = searchResult.error;
    }
  } else if (execution.status === "ok" && execution.kind === "trend_radar") {
    const trendResult = await getTrendRadar();
    if (trendResult.ok) {
      const rising = trendResult.data.trends.filter((t) => t.isRising);
      assistantContent =
        rising.length === 0
          ? "No category is trending up right now."
          : `${rising.length} categor${rising.length === 1 ? "y is" : "ies are"} trending up: ${rising.map((t) => t.category).join(", ")}.`;
      structured = { type: "trend_radar_report", trends: trendResult.data.trends };
    } else {
      assistantContent = trendResult.error;
    }
  } else if (execution.status === "ok" && execution.kind === "promise_tracker") {
    const trackerResult = await getPromiseTracker();
    if (trackerResult.ok) {
      const { gaps } = trackerResult.data;
      assistantContent =
        gaps.length === 0
          ? "No decisions are missing a recorded follow-up action."
          : `${gaps.length} decision${gaps.length === 1 ? "" : "s"} still ${gaps.length === 1 ? "has" : "have"} no recorded follow-up action.`;
      structured = { type: "promise_tracker_report", gaps, meetingScopedDecisionCount: trackerResult.data.meetingScopedDecisionCount };
    } else {
      assistantContent = trackerResult.error;
    }
  } else if (execution.status === "ok" && execution.kind === "general_workspace_question") {
    // The only Stage 7 path that calls Groq — see chat-inbox-answer.ts for
    // the request-count bound and the citation-allowlist re-validation
    // every answer goes through before it can carry a structured card.
    const answer = await answerWorkspaceQuestion(session, execution.query);
    assistantContent = answer.content;
    structured = answer.structured;
  } else if (execution.status === "ok" && execution.kind === "proposal_builder") {
    // Also a Groq path (see chat-proposal-builder.ts for its own bounded
    // request count and citation-allowlist re-validation) — nothing here
    // saves the draft anywhere; it's chat text only, like every reply.
    const proposal = await buildProposalDraft(session, execution.topic);
    assistantContent = proposal.content;
    structured = proposal.structured;
  } else if (execution.status === "ok" && execution.kind === "draft_communication") {
    const draft = await buildCommunicationDraft(session, execution.commKind, execution.topic);
    assistantContent = draft.content;
    structured = draft.structured;
  } else if (execution.status === "ok" && execution.kind === "meeting_cleanup") {
    assistantContent = "Opening the meeting recorder.";
  } else {
    assistantContent = execution.status === "not_available" ? execution.reason : "I couldn't process that just now.";
  }

  let assistantMessageId: string;
  try {
    assistantMessageId = await insertAssistantMessage(session, conversationId, assistantContent, structured);
  } catch {
    return fail("Your message was sent, but I couldn't reply just now. Try again in a moment.");
  }

  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    conversationId,
    role: "assistant",
    content: assistantContent,
    structured,
    createdBy: session.email,
    createdAt: new Date().toISOString(),
  };

  return {
    ok: true,
    data: {
      userMessage: userResult.data,
      assistantMessage,
      intent: decision.intent,
      toolStatus: execution.status,
    },
  };
}
