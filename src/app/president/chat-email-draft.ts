import "server-only";
import type { PresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { searchInboxSuggestions, type SearchableSuggestion } from "@/lib/inbox-search";
import {
  buildEmailDraftPrompt,
  emailDraftSystemPrompt,
  EMAIL_DRAFT_LIMITS,
  type EmailDraftJson,
} from "@/lib/email-draft-prompt";
import { resolveEmailPreferences } from "@/lib/email-preferences";
import { allCitationsAllowed } from "@/lib/inbox-citations";
import { generateClassifierCompletion } from "@/lib/groq";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import { listMemories } from "./chat-memory-actions";
import type { EmailDraftStructured } from "@/lib/chat-store";

/**
 * Draft a structured, editable email (draft_email). Same read-only-
 * evidence boundary as chat-communication-draft.ts, plus one further
 * restriction: the model is never asked for, and its JSON schema has no
 * field for, a recipient email address — see email-draft-prompt.ts. This
 * is the only place in the email-drafting feature that calls Groq;
 * copying, editing, and opening a mailto: link (AIChat.tsx) make zero
 * Groq calls.
 */

const MAX_ROWS = 500;

const emailJsonSchema = {
  parse(raw: unknown): EmailDraftJson | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.subject !== "string" || typeof obj.greeting !== "string" || typeof obj.body !== "string" || typeof obj.closing !== "string") {
      return null;
    }
    const recipientName = typeof obj.recipientName === "string" && obj.recipientName.trim().length > 0 ? obj.recipientName.trim().slice(0, 120) : null;
    return {
      recipientName,
      subject: obj.subject.trim().slice(0, EMAIL_DRAFT_LIMITS.fieldLength),
      greeting: obj.greeting.trim().slice(0, EMAIL_DRAFT_LIMITS.fieldLength),
      body: obj.body.trim().slice(0, EMAIL_DRAFT_LIMITS.fieldLength),
      closing: obj.closing.trim().slice(0, EMAIL_DRAFT_LIMITS.fieldLength),
    };
  },
};

export interface EmailDraftResult {
  content: string;
  structured: EmailDraftStructured | null;
  groqRequestCount: number;
}

export async function buildEmailDraft(
  session: PresidentSession,
  topic: string,
  mode: "new" | "warmer" | "shorter" | "formal",
  existingDraft: EmailDraftJson | null,
): Promise<EmailDraftResult> {
  if (!serverEnv.groqApiKey) {
    return { content: "I can't reach the AI right now — set up GROQ_API_KEY to draft emails.", structured: null, groqRequestCount: 0 };
  }

  const limit = checkChatRateLimit(`chat:email-draft:${session.email}`, 10, 5 * 60_000);
  if (!limit.allowed) {
    return { content: "You're drafting quickly — wait a moment and try again.", structured: null, groqRequestCount: 0 };
  }

  if (mode !== "new" && !existingDraft) {
    return {
      content: "I don't have a draft to revise yet — ask me to draft the email first, then ask for a change.",
      structured: null,
      groqRequestCount: 0,
    };
  }

  const [memoriesResult, suggestionsResult] = await Promise.all([
    listMemories(),
    (async () => {
      const supabase = await createSupabaseServerClient();
      return supabase
        .from("suggestions")
        .select("id, title, description, improvement_reason, category, status, created_at")
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);
    })(),
  ]);

  if (suggestionsResult.error) {
    return { content: "The workspace could not be read. Try again in a moment.", structured: null, groqRequestCount: 0 };
  }

  const prefs = resolveEmailPreferences(memoriesResult.ok ? memoriesResult.data : []);

  const all = (suggestionsResult.data ?? []) as SearchableSuggestion[];
  const { hits } = searchInboxSuggestions(all, { query: topic || undefined }, EMAIL_DRAFT_LIMITS.maxEvidence);
  const titleByRef = new Map(hits.map((h) => [h.ref, h.title]));
  const detailById = new Map(all.map((s) => [s.id, s]));
  const evidence = hits.map((h) => ({
    ref: h.ref,
    title: h.title,
    description: detailById.get(h.id)?.description ?? "",
    status: h.status,
  }));

  const userPrompt = buildEmailDraftPrompt(topic, evidence, mode, existingDraft ?? undefined);
  const outcome = await generateClassifierCompletion(emailDraftSystemPrompt(prefs), userPrompt, {
    maxTokens: EMAIL_DRAFT_LIMITS.maxTokens,
    timeoutMs: EMAIL_DRAFT_LIMITS.timeoutMs,
  });

  if (!outcome.ok) {
    return { content: "The AI is unavailable right now — you can still write the email yourself.", structured: null, groqRequestCount: outcome.requestCount };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(outcome.content);
  } catch {
    return { content: "I couldn't draft that reliably. Try rephrasing the request.", structured: null, groqRequestCount: outcome.requestCount };
  }

  const parsed = emailJsonSchema.parse(parsedJson);
  if (!parsed) {
    return { content: "I couldn't draft that reliably. Try rephrasing the request.", structured: null, groqRequestCount: outcome.requestCount };
  }

  const combinedText = `${parsed.subject} ${parsed.body}`;
  const allowedRefs = new Set(hits.map((h) => h.ref));
  if (!allCitationsAllowed(combinedText, allowedRefs)) {
    console.error("[chat-email-draft] discarded a draft citing a ref outside its own evidence");
    return { content: "I couldn't draft that reliably from the workspace data. Try narrowing the topic.", structured: null, groqRequestCount: outcome.requestCount };
  }

  const citedRefs = [...allowedRefs].filter((ref) => combinedText.includes(`[${ref}]`));
  const structured: EmailDraftStructured = {
    type: "email_draft",
    recipientName: parsed.recipientName,
    subject: parsed.subject,
    greeting: parsed.greeting,
    body: parsed.body,
    closing: parsed.closing,
    citations: citedRefs.map((ref) => ({ ref, title: titleByRef.get(ref) ?? "" })),
  };

  return {
    content: `Draft — review before sending.\n\nSubject: ${parsed.subject}`,
    structured,
    groqRequestCount: outcome.requestCount,
  };
}
