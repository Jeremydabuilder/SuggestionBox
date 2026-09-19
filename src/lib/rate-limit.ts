import "server-only";
import { createHash } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** How many submissions one source may make, and over what window. */
export const RATE_LIMIT = {
  perWindow: 3,
  windowMinutes: 10,
  perDay: 12,
} as const;

/** IP addresses are never stored in the clear. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${serverEnv.ipHashSalt}:${ip}`).digest("hex");
}

export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkRateLimit(ipHash: string): Promise<RateLimitResult> {
  const service = createSupabaseServiceClient();
  const windowStart = new Date(Date.now() - RATE_LIMIT.windowMinutes * 60_000).toISOString();
  const dayStart = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const { data, error } = await service
    .from("submission_log")
    .select("created_at")
    .eq("ip_hash", ipHash)
    .gte("created_at", dayStart)
    .order("created_at", { ascending: false })
    .limit(RATE_LIMIT.perDay);

  if (error) {
    // Fail closed: if we cannot verify the limit we do not accept the write.
    console.error("[rate-limit] lookup failed:", error.message);
    return { allowed: false, retryAfterSeconds: 60 };
  }

  const rows = data ?? [];
  if (rows.length >= RATE_LIMIT.perDay) {
    return { allowed: false, retryAfterSeconds: 60 * 60 };
  }

  const inWindow = rows.filter((r) => r.created_at >= windowStart);
  if (inWindow.length >= RATE_LIMIT.perWindow) {
    const oldest = new Date(inWindow[inWindow.length - 1]!.created_at).getTime();
    const retryAfter = Math.max(
      30,
      Math.ceil((oldest + RATE_LIMIT.windowMinutes * 60_000 - Date.now()) / 1000),
    );
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordSubmission(ipHash: string): Promise<void> {
  const service = createSupabaseServiceClient();
  const { error } = await service.from("submission_log").insert({ ip_hash: ipHash });
  if (error) console.error("[rate-limit] could not record submission:", error.message);
}
