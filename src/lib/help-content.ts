/**
 * One shared source of truth for "how does this work" answers — the
 * public /help page, the co-president help panel, and the agent's
 * deterministic help answers (see chat-router-deterministic.ts's "trash"-
 * style keyword routes and chat-tool-registry.ts's executeRoute) all read
 * from this same list, so the wording can never drift apart between them.
 * Every entry describes something that actually exists in the app today —
 * nothing planned, nothing aspirational. No "server-only" import here on
 * purpose: this is plain data, safe to import from a public page, a
 * protected page, and a server-only routing file alike.
 */

export type HelpAudience = "student" | "president";

export interface HelpTopic {
  id: string;
  audience: HelpAudience;
  question: string;
  /** Plain text, one or more short paragraphs. No markdown, no HTML. */
  answer: string[];
  /** Extra keywords the deterministic agent router can match, beyond words already in the question. */
  keywords?: string[];
}

export const STUDENT_HELP_TOPICS: HelpTopic[] = [
  {
    id: "what-is-this",
    audience: "student",
    question: "What is the Suggestion Box?",
    answer: [
      "A private way to send an idea straight to the two student-government co-presidents. There's no public feed, no voting, and no comments — nobody but the co-presidents ever sees what you write.",
    ],
  },
  {
    id: "why-sign-in",
    audience: "student",
    question: "Do I have to sign in?",
    answer: [
      "No. You can submit anonymously with no account at all — just tick \"Submit without my name.\"",
      "Signing in with your school email is only for students who want to track their own ideas afterward on the My Ideas page. It's never required to submit, and an anonymous idea is never linked to your account even if you happen to be signed in.",
    ],
  },
  {
    id: "what-data-is-stored",
    audience: "student",
    question: "What information is stored about my idea?",
    answer: [
      "The title, details, category, and why it would help — plus, if you chose to give them, your name and email. If you submitted anonymously, no name or email is stored with it at all.",
      "The co-presidents can leave private notes about your idea between themselves. You never see those notes, and they're not shown anywhere public.",
    ],
  },
  {
    id: "how-to-submit",
    audience: "student",
    question: "How do I submit an idea?",
    answer: [
      "On the home page, fill in a short title, the details, pick a category, and say why it would make school better. Optionally add your name and email, or tick the box to stay anonymous. Submit — you'll see it fold into the box once it's saved.",
    ],
  },
  {
    id: "categories",
    audience: "student",
    question: "What categories can I choose from?",
    answer: ["Events, Food, School Spaces, Clubs and Activities, Community, or Other — pick whichever fits best."],
  },
  {
    id: "what-happens-after",
    audience: "student",
    question: "What happens after I submit?",
    answer: [
      "Your idea goes straight into the co-presidents' private inbox. They read it, may leave it as is, discuss it, mark it approved or declined, or group it with similar ideas from other students.",
      "If you signed in and submitted with your name, you can check its status any time on My Ideas. There's no notification when it changes — you have to check.",
    ],
  },
  {
    id: "privacy-limits",
    audience: "student",
    question: "Who can see my idea?",
    answer: [
      "Only the two authorized co-presidents, who sign in through a separate, real login the rest of the school can't reach. There's no public list of suggestions anywhere on the site.",
      "In rare cases a co-president can remove a suggestion from active review. It's recoverable at first; a permanent removal requires a deliberate, two-step confirmation and leaves no record of your name, email, or what you wrote — only that something was removed, when, and by whom.",
    ],
  },
  {
    id: "what-not-to-submit",
    audience: "student",
    question: "What shouldn't I submit here?",
    answer: [
      "This box is for ideas and suggestions — not for reporting something urgent or someone's safety. If you or someone else is in danger, or you need to report bullying, harassment, or a safety concern, go through your school's normal channels: talk to a teacher, counselor, or administrator directly, or use whatever safety-reporting system your school already has. This box is read when a co-president gets to it, not monitored in real time.",
    ],
  },
];

export const PRESIDENT_HELP_TOPICS: HelpTopic[] = [
  {
    id: "inbox",
    audience: "president",
    question: "How does the inbox work?",
    answer: [
      "Every submitted suggestion lands in the Inbox tab, newest first by default. Filter by category, status, or read/unread, or search by text. Opening one marks it read and shows its full detail, internal notes, and status history.",
    ],
    keywords: ["dashboard", "filter", "search inbox"],
  },
  {
    id: "duplicate-detection",
    audience: "president",
    question: "How does duplicate detection work?",
    answer: [
      "After each new submission, the app compares it against active suggestions using title, description, and keyword similarity, and flags likely matches with a score. You decide: Mark as related (confirmed) or Not a duplicate (dismissed) — either decision is permanent and a later rescan will never re-raise a dismissed pair or second-guess a confirmed one.",
    ],
    keywords: ["similar", "matches", "duplicates"],
  },
  {
    id: "archive-vs-trash",
    audience: "president",
    question: "What's the difference between Archive and Trash?",
    answer: [
      "Archived is a normal status, like Approved or Declined — it stays fully visible everywhere, just filed away. Trash is a separate holding area: a trashed suggestion disappears from the inbox, dashboard counts, duplicate scans, trends, the agent, and the student's own My Ideas page, until a co-president restores it or permanently deletes it.",
    ],
    keywords: ["archive", "trash"],
  },
  {
    id: "trash-restore-delete",
    audience: "president",
    question: "How do I restore or permanently delete a trashed suggestion?",
    answer: [
      "Open the Trash tab (or a suggestion's Move to Trash button to send one there). From Trash, Restore brings it back exactly as it was — nothing is duplicated or lost.",
      "Permanently deleting one first shows what else would be removed with it (notes, status history, duplicate links, meeting citations), then requires typing an exact confirmation phrase and a second, separate confirmation click. It cannot be undone, and only a signed-in co-president can do it — never the agent.",
    ],
    keywords: ["permanently delete", "restore", "recover"],
  },
  {
    id: "dashboard-counts",
    audience: "president",
    question: "What do the dashboard counts mean?",
    answer: ["The header shows how many suggestions are unread. A trashed suggestion is never counted here."],
  },
  {
    id: "agent-overview",
    audience: "president",
    question: "What is the Co-President Agent?",
    answer: [
      "An AI assistant in the AI Workspace tab that can search the inbox, pull up trends, check follow-through gaps, prepare meetings, and more — but it never changes anything on its own. Anything it drafts (a meeting brief, a proposal, an announcement) is a suggestion for you to review, edit, and save yourself.",
    ],
    keywords: ["ai workspace", "assistant", "co-president agent"],
  },
  {
    id: "agent-memory",
    audience: "president",
    question: "What does the agent remember, and how?",
    answer: [
      "The agent can remember durable facts or preferences you tell it to (like what to call it, or how you like answers formatted) — but only after it proposes the memory and you explicitly confirm it. Manage everything it remembers in Memory Manager: view, edit, or delete any entry at any time.",
    ],
    keywords: ["memory manager", "remember"],
  },
  {
    id: "agent-tools-confirmation",
    audience: "president",
    question: "What can the agent actually do, and what needs my confirmation?",
    answer: [
      "It can read and summarize existing data (search, trends, promise tracker, decisions, actions, meeting history) with no confirmation needed, since nothing changes. Anything that would change data — saving a memory, a meeting brief, a decision, or an action — always shows you a plan or a draft first and waits for an explicit confirm.",
      "It can open Trash and tell you what's there, but it can never trash, restore, or permanently delete a suggestion itself — those buttons only work for you.",
    ],
    keywords: ["confirmation", "tools", "what can the agent do"],
  },
  {
    id: "since-last-meeting",
    audience: "president",
    question: "What is Since Last Meeting?",
    answer: [
      "A deterministic report of exactly what changed in the inbox since a saved meeting — new suggestions, status changes, and more — with no AI involved. Ask the agent, or open it from Meeting History.",
    ],
  },
  {
    id: "trends-promise-tracker",
    audience: "president",
    question: "What do Trend Radar and Promise Tracker show?",
    answer: [
      "Trend Radar compares recent, prior, and older submission counts per category and labels each Emerging, Sustained, Cooling, or Insufficient evidence — never a fake precise number from too little data.",
      "Promise Tracker flags three kinds of follow-through gaps: a decision with no recorded action, an approved suggestion with no linked action, and an open action nobody has touched since it was created. Both are fully deterministic — no Groq call, no guessing.",
    ],
    keywords: ["trend radar", "promise tracker", "follow-up", "follow through"],
  },
  {
    id: "meeting-prep-history",
    audience: "president",
    question: "How do meeting prep and meeting history work?",
    answer: [
      "Meeting Prep drafts an agenda from the current inbox — themes, quick wins, and discussion points. Save it and it becomes a Meeting History entry you can reopen, archive, or restore later. Nothing saves automatically; you review and save it yourself.",
    ],
  },
  {
    id: "decisions-actions",
    audience: "president",
    question: "How do decisions and action items work?",
    answer: [
      "Log a decision, optionally tied to a meeting and citing the suggestions behind it. Action items track a follow-up task, who it came from, and whether it's done. Both are shared between co-presidents in real time.",
    ],
  },
  {
    id: "proposal-communication-drafts",
    audience: "president",
    question: "What do Proposal Builder and draft communications do?",
    answer: [
      "Proposal Builder drafts a written proposal from selected or related suggestions. Draft communications write an announcement, update, or recap. Both only ever produce chat text for you to copy, edit, and send yourself — nothing is ever sent automatically.",
    ],
  },
  {
    id: "recorder-cleanup",
    audience: "president",
    question: "How does meeting recording and cleanup work?",
    answer: [
      "Record, upload, or paste a meeting transcript, and it's organized into review categories (possible decisions, possible actions, and so on) for you to accept or discard one at a time — nothing is saved to the decision log or action list without your explicit review.",
    ],
    keywords: ["recorder", "transcript", "cleanup review"],
  },
  {
    id: "groq-unavailable",
    audience: "president",
    question: "What happens if the AI (Groq) is unavailable?",
    answer: [
      "Anything that needs it (meeting prep, proposals, draft communications, open-ended questions) tells you honestly that the AI classifier or drafting model is unavailable rather than guessing or failing silently. Deterministic tools — search, trends, promise tracker, decisions, actions, since-last-meeting, trash — keep working regardless, since none of them ever call it.",
    ],
    keywords: ["groq", "unavailable", "offline"],
  },
  {
    id: "privacy-what-ai-cannot-do",
    audience: "president",
    question: "What can't the AI do?",
    answer: [
      "It never sees a student's name or email — those are stripped before anything is sent to it. It can't send a message, change a suggestion's status, save anything without your confirmation, or act during a multi-step plan on anything that needs one. It doesn't rank, score, or infer anything about a specific student.",
    ],
    keywords: ["privacy", "student data", "what can't the ai do"],
  },
];

export const ALL_HELP_TOPICS: HelpTopic[] = [...STUDENT_HELP_TOPICS, ...PRESIDENT_HELP_TOPICS];

export function findHelpTopic(id: string): HelpTopic | undefined {
  return ALL_HELP_TOPICS.find((t) => t.id === id);
}

/**
 * Loose keyword match used by the agent's deterministic router — never a
 * Groq call. Matches on the topic's own question text plus its extra
 * keywords; returns the first (best-effort) match or undefined. Intended
 * only for short, fairly specific phrases the same way the rest of
 * chat-router-deterministic.ts already works.
 */
export function matchHelpTopic(message: string, audience: HelpAudience): HelpTopic | undefined {
  const lower = message.toLowerCase();
  const pool = audience === "president" ? PRESIDENT_HELP_TOPICS : STUDENT_HELP_TOPICS;
  return pool.find((topic) => {
    const haystack = [topic.question, ...(topic.keywords ?? [])].join(" ").toLowerCase();
    // >= 5 chars deliberately excludes generic verbs ("does", "work",
    // "what", "how") that would otherwise let an unrelated question match
    // the first topic that happens to share one of them.
    const words = [...new Set(haystack.split(/[^a-z]+/).filter((w) => w.length >= 5))];
    const hits = words.filter((w) => lower.includes(w));
    return hits.length >= Math.min(2, words.length);
  });
}
