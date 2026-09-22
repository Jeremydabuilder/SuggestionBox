import type { ChatIntent, RouteDecision } from "@/lib/chat-intents";

/**
 * No `server-only` import here, deliberately — this is pure metadata (no
 * secrets, no I/O), and this codebase's own convention (see lib/groq.ts's
 * pure rankGroqModels, and lib/chat-rate-limit.ts) is to keep data/logic
 * like this directly unit-testable rather than blocked behind an import
 * that only resolves inside Next's bundler. "Server-only" in practice is
 * enforced and regression-tested instead: nothing under src/components may
 * import this file (see test/chat-router-guard.test.ts), and it is only
 * ever consumed by chat-router.ts, which is itself never exported as a
 * Server Action and never reachable from the browser.
 *
 * This is the fixed, closed set of what the chat agent is even allowed to
 * be routed to. There is no generic SQL tool, HTTP tool, shell tool,
 * arbitrary-table reader, arbitrary-mutation tool, or dynamic import path
 * anywhere in this file or reachable from it — every entry names one, and
 * only one, of the enum intents from lib/chat-intents.ts, and nothing here
 * accepts a string tool name at runtime.
 */

export type ToolClassification = "read_only" | "draft" | "confirmation_required";
export type ImplementationStatus = "implemented" | "planned" | "not_connected";

export interface ToolRegistryEntry {
  intent: ChatIntent;
  classification: ToolClassification;
  /** Whether a later stage may use Groq to turn this tool's result into prose. Never itself a permission to call Groq for anything else. */
  groqSynthesisEligible: boolean;
  /** Hard cap on records this tool may ever return/consider, once connected. */
  maxRecords: number;
  authLevel: "president";
  status: ImplementationStatus;
  description: string;
}

export const CHAT_TOOL_REGISTRY: Record<ChatIntent, ToolRegistryEntry> = {
  help: {
    intent: "help",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 0,
    authLevel: "president",
    status: "implemented",
    description: "Lists what the AI workspace can currently help with.",
  },
  search_inbox: {
    intent: "search_inbox",
    classification: "read_only",
    groqSynthesisEligible: true,
    maxRecords: 50,
    authLevel: "president",
    status: "planned",
    description: "Search and filter suggestions by text, category, or status.",
  },
  suggestion_details: {
    intent: "suggestion_details",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 1,
    authLevel: "president",
    status: "planned",
    description: "Open one suggestion's full detail by S### reference.",
  },
  related_suggestions: {
    intent: "related_suggestions",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 10,
    authLevel: "president",
    status: "planned",
    description: "Find suggestions related or duplicate to a given one.",
  },
  since_last_meeting: {
    intent: "since_last_meeting",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 500,
    authLevel: "president",
    status: "implemented",
    description: "A deterministic report of what changed since a saved meeting.",
  },
  meeting_prep: {
    intent: "meeting_prep",
    classification: "draft",
    groqSynthesisEligible: true,
    maxRecords: 120,
    authLevel: "president",
    status: "implemented",
    description: "Generate a draft meeting brief from the current inbox.",
  },
  meeting_history: {
    intent: "meeting_history",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 50,
    authLevel: "president",
    status: "implemented",
    description: "List or open saved meeting briefs.",
  },
  list_decisions: {
    intent: "list_decisions",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 200,
    authLevel: "president",
    status: "implemented",
    description: "List, search, or filter the decision log.",
  },
  list_actions: {
    intent: "list_actions",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 200,
    authLevel: "president",
    status: "implemented",
    description: "List or filter shared action items.",
  },
  proposal_builder: {
    intent: "proposal_builder",
    classification: "draft",
    groqSynthesisEligible: true,
    maxRecords: 50,
    authLevel: "president",
    status: "planned",
    description: "Draft a proposal from selected or related suggestions.",
  },
  trend_radar: {
    intent: "trend_radar",
    classification: "read_only",
    groqSynthesisEligible: true,
    maxRecords: 200,
    authLevel: "president",
    status: "planned",
    description: "Surface sustained or rapidly increasing themes, with counts.",
  },
  promise_tracker: {
    intent: "promise_tracker",
    classification: "read_only",
    groqSynthesisEligible: true,
    maxRecords: 100,
    authLevel: "president",
    status: "planned",
    description: "Connect decisions to their follow-up actions and flag gaps.",
  },
  draft_communication: {
    intent: "draft_communication",
    classification: "draft",
    groqSynthesisEligible: true,
    maxRecords: 20,
    authLevel: "president",
    status: "planned",
    description: "Draft an announcement, update, or recap. Never sends anything.",
  },
  meeting_cleanup: {
    intent: "meeting_cleanup",
    classification: "confirmation_required",
    groqSynthesisEligible: true,
    maxRecords: 1,
    authLevel: "president",
    status: "not_connected",
    description: "Organize an approved transcript into review categories.",
  },
  memory_manager: {
    intent: "memory_manager",
    classification: "confirmation_required",
    groqSynthesisEligible: false,
    maxRecords: 200,
    authLevel: "president",
    status: "implemented",
    description: "List, propose, or confirm durable memory changes.",
  },
  general_workspace_question: {
    intent: "general_workspace_question",
    classification: "read_only",
    groqSynthesisEligible: true,
    maxRecords: 0,
    authLevel: "president",
    status: "planned",
    description: "Answer a workspace question that doesn't fit a specific tool.",
  },
  clarification_needed: {
    intent: "clarification_needed",
    classification: "read_only",
    groqSynthesisEligible: false,
    maxRecords: 0,
    authLevel: "president",
    status: "implemented",
    description: "Asks the president a short clarifying question instead of guessing.",
  },
};

const HELP_MESSAGE = [
  "Here's what I can help with once each piece is connected:",
  "- Prepare a meeting agenda from the current inbox",
  "- Tell you what changed since your last saved meeting",
  "- Search and answer questions about student suggestions",
  "- List decisions and action items, and their status",
  "- Build a proposal from related suggestions",
  "- Draft an announcement or update (never sends it)",
  "- Manage what I'm allowed to remember between conversations",
  "",
  "Right now, most of these are still being wired up — ask, and I'll tell you honestly if a feature isn't available yet.",
].join("\n");

export type ToolExecutionResult =
  | { status: "ok"; kind: "help"; message: string }
  | { status: "ok"; kind: "clarification"; question: string }
  | { status: "ok"; kind: "memory_manager"; action: "list" | "search"; query?: string }
  | { status: "ok"; kind: "meeting_prep" }
  | { status: "ok"; kind: "meeting_history" }
  | { status: "ok"; kind: "list_decisions" }
  | { status: "ok"; kind: "list_actions" }
  | { status: "ok"; kind: "since_last_meeting"; meetingId: string | null }
  | { status: "not_available"; intent: ChatIntent; reason: string };

/**
 * Looks the route up in the fixed registry and returns an honest typed
 * result. Nothing here performs a mutation, a database read, or a Groq
 * call — memory_manager, meeting_prep, meeting_history, list_decisions,
 * and list_actions only ever tell the caller which existing, already-
 * secured panel to open (MemoryManagerPanel, MeetingAgent, MeetingHistory,
 * DecisionLog, ActionItems). Each of those panels fetches its own data and
 * performs its own mutations through the same session-checked,
 * RLS-enforced server actions that ran before this chat existed — every
 * create/edit/delete there already requires the president to review a
 * form and click an explicit save/delete button, which is the same
 * "nothing happens without an explicit act" guarantee the Stage 1/2
 * confirmation-card boundary gives chat-authored memory changes.
 * since_last_meeting is different — it is read-only and safe to answer
 * inline, so it just tells the caller which meeting to use as the cutoff;
 * the actual (deterministic, zero-Groq) report is built by
 * since-last-meeting-actions.ts and rendered as a structured chat card,
 * never a separate panel. An intent whose registry status isn't
 * "implemented" always comes back as `not_available`, never a fabricated
 * record or a simulated success.
 */
export function executeRoute(decision: RouteDecision): ToolExecutionResult {
  if (decision.intent === "clarification_needed") {
    return { status: "ok", kind: "clarification", question: decision.clarificationQuestion ?? "Could you say more about what you'd like?" };
  }

  const entry = CHAT_TOOL_REGISTRY[decision.intent];

  if (decision.intent === "help" && entry.status === "implemented") {
    return { status: "ok", kind: "help", message: HELP_MESSAGE };
  }

  if (decision.intent === "memory_manager" && entry.status === "implemented") {
    const args = decision.args as { action?: "list" | "search"; query?: string };
    return { status: "ok", kind: "memory_manager", action: args.action ?? "list", query: args.query };
  }

  if (decision.intent === "meeting_prep" && entry.status === "implemented") {
    return { status: "ok", kind: "meeting_prep" };
  }

  if (decision.intent === "meeting_history" && entry.status === "implemented") {
    return { status: "ok", kind: "meeting_history" };
  }

  if (decision.intent === "list_decisions" && entry.status === "implemented") {
    return { status: "ok", kind: "list_decisions" };
  }

  if (decision.intent === "list_actions" && entry.status === "implemented") {
    return { status: "ok", kind: "list_actions" };
  }

  if (decision.intent === "since_last_meeting" && entry.status === "implemented") {
    const args = decision.args as { meetingId?: string };
    return { status: "ok", kind: "since_last_meeting", meetingId: args.meetingId ?? null };
  }

  return {
    status: "not_available",
    intent: decision.intent,
    reason: `"${entry.description}" is not available in this stage yet.`,
  };
}
