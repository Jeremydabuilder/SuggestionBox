"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/sanitize";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import { checkMemoryContent } from "@/lib/memory-guard";
import {
  saveMemoryPayloadSchema,
  updateMemoryPayloadSchema,
  deleteMemoryPayloadSchema,
  CHAT_LIMITS,
  MEMORY_CATEGORIES,
  type Memory,
  type MemoryCategory,
} from "@/lib/chat-store";
import { proposeMemoryAction, applyMemoryConfirmation, invalidatePendingConfirmation } from "./chat-assistant-internal";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MemoryRow {
  id: string;
  memory_text: string;
  category: MemoryCategory | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    memoryText: row.memory_text,
    category: row.category,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function normalizeCategory(raw: unknown): MemoryCategory | null {
  return typeof raw === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(raw) ? (raw as MemoryCategory) : null;
}

/* ------------------------------------------------------------------ */
/* Listing — read-only, no confirmation needed                         */
/* ------------------------------------------------------------------ */

export async function listMemories(options?: { query?: string }): Promise<ActionResult<Memory[]>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("chat_memories").select("*").order("created_at", { ascending: false }).limit(200);

  const needle = typeof options?.query === "string" ? sanitizeText(options.query, CHAT_LIMITS.memoryText) : "";
  if (needle) query = query.ilike("memory_text", `%${needle}%`);

  const { data, error } = await query;
  if (error) return fail("Memories could not be loaded. Try again in a moment.");

  return { ok: true, data: ((data ?? []) as MemoryRow[]).map(mapMemory) };
}

/* ------------------------------------------------------------------ */
/* Propose — never mutates chat_memories. Creates a trusted assistant   */
/* proposal card + a pending confirmation; nothing more.                */
/* ------------------------------------------------------------------ */

export async function requestCreateMemory(
  conversationId: string,
  rawMemoryText: unknown,
  rawCategory?: unknown,
): Promise<ActionResult<{ confirmationId: string }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(conversationId)) return fail("Unknown conversation.");

  const limit = checkChatRateLimit(`chat:memory-propose:${session.email}`, 15, 10 * 60_000);
  if (!limit.allowed) return fail("Please wait a moment before proposing another memory.");

  const cleanedText = sanitizeText(rawMemoryText, CHAT_LIMITS.memoryText);
  const parsed = saveMemoryPayloadSchema.safeParse({ memoryText: cleanedText, category: normalizeCategory(rawCategory) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That memory didn't pass validation.");

  const contentCheck = checkMemoryContent(parsed.data.memoryText);
  if (!contentCheck.allowed) {
    // Never log the rejected content itself — only that a rejection happened and why.
    console.warn(`[chat-memory] rejected a memory proposal: ${contentCheck.reason}`);
    return fail("That can't be saved as a memory — it looks like it may contain private or sensitive information.");
  }

  try {
    const { confirmationId } = await proposeMemoryAction(
      session,
      conversationId,
      "save_memory",
      { memoryText: parsed.data.memoryText, category: parsed.data.category ?? null },
      `Remember: "${parsed.data.memoryText}"?`,
      { memoryText: parsed.data.memoryText, category: parsed.data.category ?? null },
    );
    revalidatePath("/president");
    return { ok: true, data: { confirmationId } };
  } catch {
    return fail("That proposal couldn't be created. Try again in a moment.");
  }
}

export async function requestEditMemory(
  conversationId: string,
  memoryId: string,
  expectedUpdatedAt: string,
  rawMemoryText: unknown,
  rawCategory?: unknown,
): Promise<ActionResult<{ confirmationId: string }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(conversationId) || !UUID_RE.test(memoryId)) return fail("Unknown conversation or memory.");

  const limit = checkChatRateLimit(`chat:memory-propose:${session.email}`, 15, 10 * 60_000);
  if (!limit.allowed) return fail("Please wait a moment before proposing another change.");

  const cleanedText = sanitizeText(rawMemoryText, CHAT_LIMITS.memoryText);
  const parsed = updateMemoryPayloadSchema.safeParse({
    memoryId,
    memoryText: cleanedText,
    category: normalizeCategory(rawCategory),
    expectedUpdatedAt,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That edit didn't pass validation.");

  const contentCheck = checkMemoryContent(parsed.data.memoryText ?? "");
  if (!contentCheck.allowed) {
    console.warn(`[chat-memory] rejected a memory edit: ${contentCheck.reason}`);
    return fail("That can't be saved as a memory — it looks like it may contain private or sensitive information.");
  }

  try {
    const { confirmationId } = await proposeMemoryAction(
      session,
      conversationId,
      "update_memory",
      parsed.data,
      `Update this memory to: "${parsed.data.memoryText}"?`,
      { memoryText: parsed.data.memoryText ?? "", category: parsed.data.category ?? null },
    );
    revalidatePath("/president");
    return { ok: true, data: { confirmationId } };
  } catch {
    return fail("That proposal couldn't be created. Try again in a moment.");
  }
}

export async function requestDeleteMemory(
  conversationId: string,
  memoryId: string,
  expectedUpdatedAt: string,
  memoryTextForDisplay: string,
): Promise<ActionResult<{ confirmationId: string }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(conversationId) || !UUID_RE.test(memoryId)) return fail("Unknown conversation or memory.");

  const limit = checkChatRateLimit(`chat:memory-propose:${session.email}`, 15, 10 * 60_000);
  if (!limit.allowed) return fail("Please wait a moment before proposing another change.");

  const parsed = deleteMemoryPayloadSchema.safeParse({ memoryId, expectedUpdatedAt });
  if (!parsed.success) return fail("That request didn't pass validation.");

  try {
    const { confirmationId } = await proposeMemoryAction(
      session,
      conversationId,
      "delete_memory",
      parsed.data,
      `Forget the memory: "${sanitizeText(memoryTextForDisplay, CHAT_LIMITS.memoryText)}"?`,
      { memoryText: sanitizeText(memoryTextForDisplay, CHAT_LIMITS.memoryText), category: null },
    );
    revalidatePath("/president");
    return { ok: true, data: { confirmationId } };
  } catch {
    return fail("That proposal couldn't be created. Try again in a moment.");
  }
}

/* ------------------------------------------------------------------ */
/* Confirm / cancel                                                     */
/* ------------------------------------------------------------------ */

export async function confirmMemoryAction(confirmationId: string): Promise<ActionResult<{ memoryId?: string }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(confirmationId)) return fail("Unknown confirmation.");

  const limit = checkChatRateLimit(`chat:memory-confirm:${session.email}`, 30, 10 * 60_000);
  if (!limit.allowed) return fail("Please wait a moment and try again.");

  const result = await applyMemoryConfirmation(session, confirmationId);
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "That confirmation could not be found.",
      wrong_action_type: "That confirmation is not a memory action.",
      not_pending: "That confirmation has already been used or cancelled.",
      expired: "That confirmation has expired. Ask again to get a fresh one.",
      invalid_payload: "That proposal was malformed and could not be applied.",
      stale_or_missing: "That memory has changed since this was proposed. Please try again.",
      server_error: "Something went wrong. Try again in a moment.",
    };
    return fail(messages[result.error ?? ""] ?? "That confirmation could not be applied.");
  }

  revalidatePath("/president");
  return { ok: true, data: { memoryId: result.memoryId } };
}

export async function cancelMemoryAction(confirmationId: string): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(confirmationId)) return fail("Unknown confirmation.");

  const cancelled = await invalidatePendingConfirmation(confirmationId);
  if (!cancelled) return fail("That confirmation was already used, expired, or cancelled.");

  revalidatePath("/president");
  return { ok: true };
}
