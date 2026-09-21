import { z } from "zod";

export const CHAT_LIMITS = {
  title: 200,
  userMessage: 4000,
  memoryText: 500,
} as const;

export const MEMORY_CATEGORIES = ["meeting_format", "terminology", "tone", "constraint", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const conversationTitleSchema = z
  .string()
  .trim()
  .min(1, "Give the conversation a title.")
  .max(CHAT_LIMITS.title, `Keep the title to ${CHAT_LIMITS.title} characters or fewer.`);

export const userMessageContentSchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(CHAT_LIMITS.userMessage, `Keep messages to ${CHAT_LIMITS.userMessage} characters or fewer.`);

/* ------------------------------------------------------------------ */
/* Structured assistant content — what a chat_messages.structured JSON */
/* value is allowed to look like. Nothing outside this union may ever  */
/* be trusted or rendered as more than plain text.                     */
/* ------------------------------------------------------------------ */

export const memoryProposalStructuredSchema = z.object({
  type: z.literal("memory_proposal"),
  confirmationId: z.string().uuid(),
  operation: z.enum(["create", "update", "delete"]),
  memoryText: z.string().min(1).max(CHAT_LIMITS.memoryText),
  category: z.enum(MEMORY_CATEGORIES).nullable(),
});
export type MemoryProposalStructured = z.infer<typeof memoryProposalStructuredSchema>;

export const statusStructuredSchema = z.object({
  type: z.literal("status"),
  status: z.enum(["confirmed", "cancelled", "expired", "error"]),
  message: z.string().min(1).max(300),
});
export type StatusStructured = z.infer<typeof statusStructuredSchema>;

export const assistantStructuredSchema = z.discriminatedUnion("type", [
  memoryProposalStructuredSchema,
  statusStructuredSchema,
]);
export type AssistantStructured = z.infer<typeof assistantStructuredSchema>;

/* ------------------------------------------------------------------ */
/* Pending-confirmation payload schemas — must match exactly what      */
/* public.apply_chat_memory_confirmation() reads out of `payload`.     */
/* ------------------------------------------------------------------ */

export const saveMemoryPayloadSchema = z.object({
  memoryText: z.string().trim().min(1).max(CHAT_LIMITS.memoryText),
  category: z.enum(MEMORY_CATEGORIES).nullable().optional(),
});
export type SaveMemoryPayload = z.infer<typeof saveMemoryPayloadSchema>;

export const updateMemoryPayloadSchema = z.object({
  memoryId: z.string().uuid(),
  memoryText: z.string().trim().min(1).max(CHAT_LIMITS.memoryText).optional(),
  category: z.enum(MEMORY_CATEGORIES).nullable().optional(),
  expectedUpdatedAt: z.string().min(1),
});
export type UpdateMemoryPayload = z.infer<typeof updateMemoryPayloadSchema>;

export const deleteMemoryPayloadSchema = z.object({
  memoryId: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
});
export type DeleteMemoryPayload = z.infer<typeof deleteMemoryPayloadSchema>;

/* ------------------------------------------------------------------ */
/* Row / application types                                             */
/* ------------------------------------------------------------------ */

export interface ChatConversation {
  id: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  structured: AssistantStructured | null;
  createdBy: string;
  createdAt: string;
}

export type PendingConfirmationStatus = "pending" | "confirmed" | "expired" | "invalidated";

export interface Memory {
  id: string;
  memoryText: string;
  category: MemoryCategory | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}
