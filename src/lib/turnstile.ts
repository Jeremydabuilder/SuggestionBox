import "server-only";
import { serverEnv } from "@/lib/env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verifies a Cloudflare Turnstile token.
 *
 * Turnstile is active whenever TURNSTILE_SECRET_KEY is configured. If it is
 * not configured the check is skipped and a warning is logged — the app still
 * has server-side validation and rate limiting, but you should set the keys
 * before opening submissions to students.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string,
): Promise<TurnstileResult> {
  const secret = serverEnv.turnstileSecretKey;
  if (!secret) {
    console.warn(
      "[turnstile] TURNSTILE_SECRET_KEY is not set — bot protection is disabled.",
    );
    return { ok: true };
  }

  if (!token) return { ok: false, reason: "missing-token" };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true };
    return { ok: false, reason: data["error-codes"]?.join(",") ?? "rejected" };
  } catch (error) {
    console.error("[turnstile] verification request failed:", error);
    return { ok: false, reason: "verification-unavailable" };
  }
}

export function turnstileConfigured(): boolean {
  return Boolean(serverEnv.turnstileSecretKey);
}
