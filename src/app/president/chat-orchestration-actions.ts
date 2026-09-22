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
import { listMeetingBriefs } from "./workspace-actions";
import { listDecisions } from "./decisions-actions";
import { listActionItems } from "./action-items-actions";
import { runAgentTurn, type AgentTurnResult } from "./agent-orchestrator";
import type { ActionResult } from "./actions";
import type { AssistantStructured, ChatMessage } from "@/lib/chat-store";

/**
 * Turns a completed agent turn into the plain-text reply shown above its
 * structured card — the card carries the full detail; this is just a
 * short, honest summary of what actually happened (never a claim about
 * a step that failed or was skipped).
 */
function formatAgentTurnContent(result: AgentTurnResult): string {
  const lines: string[] = [];
  lines.push(result.synthesizedAnswer ?? "Here's what I found:");
  for (const item of result.evidence) {
    if (item.status === "done") lines.push(`• ${item.summary}`);
  }
  if (result.evidence.some((e) => e.status === "failed")) {
    lines.push("(One step couldn't complete — see the plan above for details.)");
  }
  if (result.suggestedNextAction) lines.push(`Next: ${result.suggestedNextAction}`);
  return lines.join("\n");
}

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

  // Multi-step agent turn, tried first: a deterministic plan template, or
  // (only for a message that looks like a compound goal and that the
  // existing deterministic single-tool router doesn't already confidently
  // handle) one bounded AI planning call. Returns null for the overwhelming
  // majority of ordinary messages, which then fall through to the
  // completely unmodified single-intent path below — see
  // agent-orchestrator.ts's own doc comment for the exact precedence.
  const agentTurn = await runAgentTurn(session, userResult.data.content);

  let assistantContent: string;
  let structured: AssistantStructured | null = null;
  let routedIntent = "agent_turn";
  let toolStatus: "ok" | "not_available" = "ok";

  if (agentTurn) {
    assistantContent = formatAgentTurnContent(agentTurn);
    structured = {
      type: "agent_turn",
      planSource: agentTurn.planSource,
      plan: agentTurn.plan,
      evidence: agentTurn.evidence,
      synthesizedAnswer: agentTurn.synthesizedAnswer,
      citations: agentTurn.citations,
      suggestedNextAction: agentTurn.suggestedNextAction,
      openPanel: agentTurn.openPanel,
    };
  } else {
  const { decision, execution } = await routeChatMessage(session, userResult.data.content, recentContext);
  routedIntent = decision.intent;

  if (execution.status === "ok" && execution.kind === "help") {
    assistantContent = execution.message;
  } else if (execution.status === "ok" && execution.kind === "clarification") {
    assistantContent = execution.question;
  } else if (execution.status === "ok" && execution.kind === "memory_manager") {
    assistantContent = "Opening Memory Manager.";
  } else if (execution.status === "ok" && execution.kind === "meeting_prep") {
    assistantContent = "Opening Meeting Prep.";
  } else if (execution.status === "ok" && execution.kind === "meeting_history") {
    // Stage 10 UX fix: a plain read answers inline, in the chat itself —
    // the full MeetingHistory panel is still one click away ("Open full
    // view" on the card, or the header's own quick-access button), but a
    // read-only question no longer forces a modal open by default.
    const briefsResult = await listMeetingBriefs(false);
    if (briefsResult.ok) {
      const items = briefsResult.data.slice(0, 10);
      assistantContent = items.length === 0 ? "No saved meetings yet." : `${briefsResult.data.length} saved meeting${briefsResult.data.length === 1 ? "" : "s"}.`;
      structured = {
        type: "meeting_history_summary",
        totalCount: briefsResult.data.length,
        items: items.map((b) => ({ id: b.id, headline: b.headline, state: b.state, createdAt: b.createdAt })),
      };
    } else {
      assistantContent = briefsResult.error;
    }
  } else if (execution.status === "ok" && execution.kind === "list_decisions") {
    const decisionsResult = await listDecisions();
    if (decisionsResult.ok) {
      const items = decisionsResult.data.slice(0, 10);
      assistantContent = items.length === 0 ? "No decisions logged yet." : `${decisionsResult.data.length} decision${decisionsResult.data.length === 1 ? "" : "s"} logged.`;
      structured = {
        type: "decisions_summary",
        totalCount: decisionsResult.data.length,
        items: items.map((d) => ({ id: d.id, decisionText: d.decisionText, createdAt: d.createdAt })),
      };
    } else {
      assistantContent = decisionsResult.error;
    }
  } else if (execution.status === "ok" && execution.kind === "list_actions") {
    const actionsResult = await listActionItems();
    if (actionsResult.ok) {
      const items = actionsResult.data.slice(0, 10);
      assistantContent = items.length === 0 ? "No action items yet." : `${actionsResult.data.length} action item${actionsResult.data.length === 1 ? "" : "s"}.`;
      structured = {
        type: "actions_summary",
        totalCount: actionsResult.data.length,
        items: items.map((a) => ({ id: a.id, actionText: a.actionText, completed: a.completed, deadline: a.deadline })),
      };
    } else {
      assistantContent = actionsResult.error;
    }
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
      const { gaps, suggestionGaps, staleActionGaps } = trackerResult.data;
      const totalGaps = gaps.length + suggestionGaps.length + staleActionGaps.length;
      assistantContent =
        totalGaps === 0
          ? "No follow-through gaps found — decisions, approved suggestions, and open actions all look current."
          : [
              gaps.length > 0 ? `${gaps.length} decision${gaps.length === 1 ? "" : "s"} with no recorded follow-up action.` : null,
              suggestionGaps.length > 0 ? `${suggestionGaps.length} approved suggestion${suggestionGaps.length === 1 ? "" : "s"} with no linked action.` : null,
              staleActionGaps.length > 0 ? `${staleActionGaps.length} open action${staleActionGaps.length === 1 ? "" : "s"} untouched since it was created.` : null,
            ]
              .filter(Boolean)
              .join(" ");
      structured = { type: "promise_tracker_report", ...trackerResult.data };
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
  toolStatus = execution.status;
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
      intent: routedIntent,
      toolStatus,
    },
  };
}
