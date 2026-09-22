import { CATEGORY_VALUES, STATUS_VALUES, type Category, type Status } from "./types.ts";
import { parseIntentArgs, type RouteDecision } from "./chat-intents.ts";

/**
 * Zero-Groq routing for obvious commands and every suggested starter
 * prompt. Deliberately conservative: every pattern below is a fairly
 * specific phrase shape, not a single loose keyword, so ordinary
 * conversational text ("the meeting was great") doesn't get silently
 * routed as a command. Returns null — never a guess — when nothing here
 * confidently matches, which sends the message to the AI classifier.
 */

function decision(
  intent: RouteDecision["intent"],
  rawArgs: unknown,
  confidence: RouteDecision["confidence"] = "high",
): RouteDecision {
  const args = parseIntentArgs(intent, rawArgs);
  return { intent, args, confidence, needsClarification: false, source: "deterministic" };
}

function clarify(question: string): RouteDecision {
  const args = parseIntentArgs("clarification_needed", { question });
  return { intent: "clarification_needed", args, confidence: "high", needsClarification: true, clarificationQuestion: question, source: "deterministic" };
}

function findEnumValue<T extends string>(text: string, values: readonly T[]): T | undefined {
  const lower = text.toLowerCase();
  return values.find((value) => lower.includes(value.replace(/_/g, " ")) || lower.includes(value));
}

const STARTER_PROMPTS: Array<{ match: RegExp; build: () => RouteDecision }> = [
  { match: /^prepare (our )?next meeting$/i, build: () => decision("meeting_prep", {}) },
  { match: /^what('?s| has| changed) changed since (our )?last meeting\??$/i, build: () => decision("since_last_meeting", {}) },
  { match: /^what needs attention\??$/i, build: () => decision("since_last_meeting", {}) },
  { match: /^show open action items$/i, build: () => decision("list_actions", { status: "open" }) },
  { match: /^show (recent )?decisions$/i, build: () => decision("list_decisions", {}) },
  { match: /^search (student )?suggestions$/i, build: () => clarify("What would you like to search the inbox for?") },
  { match: /^build a proposal$/i, build: () => decision("proposal_builder", {}) },
  { match: /^draft an assembly update$/i, build: () => decision("draft_communication", { kind: "assembly_announcement" }) },
  { match: /^review meeting history$/i, build: () => decision("meeting_history", {}) },
  { match: /^show meeting history$/i, build: () => decision("meeting_history", {}) },
  { match: /^manage memory$/i, build: () => decision("memory_manager", {}) },
  { match: /^help$/i, build: () => decision("help", {}) },
  { match: /^what can you do\??$/i, build: () => decision("help", {}) },
];

interface Rule {
  match: RegExp;
  build: (m: RegExpMatchArray, text: string) => RouteDecision;
}

const RULES: Rule[] = [
  // Meeting prep
  {
    match: /\bprepare\b.*\b(meeting|agenda)\b/i,
    build: () => decision("meeting_prep", {}),
  },
  // Since last meeting
  {
    match: /\bwhat\b.*\bchanged\b.*\b(since|from)\b.*\bmeeting\b/i,
    build: () => decision("since_last_meeting", {}),
  },
  {
    match: /\b(what needs attention|needs attention)\b/i,
    build: () => decision("since_last_meeting", {}),
  },
  // Action items
  {
    match: /\b(show|list|view)\b.*\boverdue\b.*\bactions?\b/i,
    build: () => decision("list_actions", { status: "overdue" }),
  },
  {
    match: /\bdue soon\b.*\bactions?\b|\bactions?\b.*\bdue soon\b/i,
    build: () => decision("list_actions", { status: "due_soon" }),
  },
  {
    match: /\b(show|list|view)\b.*\bopen\b.*\baction( items?)?\b/i,
    build: () => decision("list_actions", { status: "open" }),
  },
  {
    match: /\baction items?\b/i,
    build: () => decision("list_actions", {}),
  },
  // Decisions
  {
    match: /\b(show|list|view)\b.*\bdecisions?\b/i,
    build: (_m, text) => {
      const topicMatch = text.match(/decisions?\s+(?:about|on|regarding)\s+(.+)/i);
      return decision("list_decisions", topicMatch ? { query: topicMatch[1]!.trim().slice(0, 200) } : {});
    },
  },
  {
    match: /\bwhat decisions\b/i,
    build: (_m, text) => {
      const topicMatch = text.match(/about\s+(.+)/i);
      return decision("list_decisions", topicMatch ? { query: topicMatch[1]!.trim().slice(0, 200) } : {});
    },
  },
  // Meeting history
  {
    match: /\b(show|review|open)\b.*\bmeeting history\b/i,
    build: () => decision("meeting_history", {}),
  },
  // Memory manager
  {
    match: /\bmanage (my |our )?memor(y|ies)\b|\bmemory manager\b/i,
    build: () => decision("memory_manager", {}),
  },
  {
    match: /\bwhat do you remember\b/i,
    build: () => decision("memory_manager", { action: "list" }),
  },
  // Proposal builder
  {
    match: /\b(build|write|create|draft)\b.*\bproposal\b|\bturn\b.*\binto a proposal\b/i,
    build: () => decision("proposal_builder", {}),
  },
  // Draft communication
  {
    match: /\bdraft\b.*\b(assembly|announcement)\b/i,
    build: () => decision("draft_communication", { kind: "assembly_announcement" }),
  },
  {
    match: /\bdraft\b.*\bmeeting recap\b/i,
    build: () => decision("draft_communication", { kind: "meeting_recap" }),
  },
  {
    match: /\bdraft\b.*\b(update|announcement|recap|request)\b/i,
    build: (_m, text) => {
      const kind = findEnumValue(text, [
        "assembly_announcement",
        "student_update",
        "status_explanation",
        "teacher_admin_request",
        "follow_up_question",
        "meeting_recap",
      ] as const);
      return decision("draft_communication", kind ? { kind } : {});
    },
  },
  // Search inbox — requires a topic; without one this falls through to clarification below.
  {
    match: /\b(search|find)\b.*\b(suggestions?|the inbox|student ideas?)\b\s*(?:about|for|on)\s+(.+)/i,
    build: (m) => decision("search_inbox", { query: m[3]!.trim().slice(0, 200) }),
  },
  {
    match: /^(?:search|find)\s+(.+)/i,
    build: (m) => decision("search_inbox", { query: m[1]!.trim().slice(0, 200) }),
  },
  // Trend radar
  {
    match: /\btrend(s|ing)?\b.*\b(inbox|suggestions?|categor(y|ies))\b|\b(what'?s|what is)\s+trending\b|\btrend radar\b/i,
    build: () => decision("trend_radar", {}),
  },
  // Promise tracker
  {
    match:
      /\b(promise|follow[- ]?up)s?\b.*\b(tracker|track|gaps?|missing)\b|\b(tracker|track|gaps?|missing)\b.*\b(promise|follow[- ]?up)s?\b|\bdecisions?\b.*\bwithout\b.*\bactions?\b|\bwhat needs (a )?follow[- ]?up\b/i,
    build: () => decision("promise_tracker", {}),
  },
  // Help
  {
    match: /^help$|^what can you do\??$|\bhow do (i|you) use (this|the workspace)\b/i,
    build: () => decision("help", {}),
  },
];

/** Category/status words the deterministic router can lift out of a plain-language query without guessing. */
function extractSearchQualifiers(text: string): { category?: Category; status?: Status } {
  const category = findEnumValue(text, CATEGORY_VALUES);
  const status = findEnumValue(text, STATUS_VALUES);
  return { category, status };
}

export function routeDeterministically(rawMessage: string): RouteDecision | null {
  const message = rawMessage.trim();
  if (!message) return null;

  for (const { match, build } of STARTER_PROMPTS) {
    if (match.test(message)) return build();
  }

  for (const rule of RULES) {
    const m = message.match(rule.match);
    if (!m) continue;
    const built = rule.build(m, message);
    // search_inbox picked up a topic above — see if it also names a
    // category/status the president typed explicitly (e.g. "search food
    // suggestions that are new"), without ever guessing at one.
    if (built.intent === "search_inbox") {
      const qualifiers = extractSearchQualifiers(message);
      const merged = { ...built.args, ...qualifiers };
      return decision("search_inbox", merged, built.confidence);
    }
    return built;
  }

  return null;
}
