import "server-only";
import { serverEnv } from "@/lib/env";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export interface PresidentSession {
  email: string;
  userId: string;
}

/**
 * Is this address one of the two approved co-presidents?
 *
 * Two independent sources have to agree, and the check runs only on the
 * server:
 *   1. the PRESIDENT_EMAILS environment variable, and
 *   2. the authorized_presidents table (which also backs the RLS policies).
 *
 * If PRESIDENT_EMAILS is left unset, the database table is the single source
 * of truth. If it is set, an address must appear in both.
 */
export async function isAuthorizedEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const allowlist = serverEnv.presidentEmails;
  if (allowlist.length > 0 && !allowlist.includes(normalized)) return false;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("authorized_presidents")
    .select("email")
    .ilike("email", normalized)
    .limit(1);

  if (error) {
    console.error("[auth] roster lookup failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Returns the signed-in co-president, or null. Server-side only — a hidden
 * URL is never treated as authentication.
 */
export async function getPresidentSession(): Promise<PresidentSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;
  if (!(await isAuthorizedEmail(user.email))) return null;

  return { email: user.email.toLowerCase(), userId: user.id };
}
