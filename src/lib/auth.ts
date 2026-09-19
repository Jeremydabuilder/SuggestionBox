import "server-only";
import { isPlaceholderEmail } from "@/lib/deployment-checks";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export interface PresidentSession {
  email: string;
  userId: string;
}

/**
 * Is this address one of the two approved co-presidents?
 *
 * The `authorized_presidents` table is the single source of truth, and the
 * check runs only on the server.
 *
 * There used to be a second list in a PRESIDENT_EMAILS environment variable
 * that had to agree with the table. It was removed: the RLS policies that
 * actually guard the data call `is_president()`, which reads the table and
 * nothing else, so the environment variable never added a real barrier. What
 * it could do was drift out of step with the table and lock a president out
 * of a site that looked fine — and it meant the two real addresses had to be
 * stored in a second place. One list, in the database, where only the
 * service role can write to it.
 */
export async function isAuthorizedEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  // A placeholder from the setup files never authorizes anyone. Those domains
  // are reserved for documentation and cannot receive a sign-in link, so an
  // address like this can only be a leftover from setup — most likely the
  // unedited roster migration.
  if (isPlaceholderEmail(normalized)) {
    console.error(
      `[auth] Refused a placeholder co-president address (${normalized}). ` +
        "Replace the placeholder rows in the authorized_presidents table " +
        "with the real addresses — see supabase/maintenance/add_presidents.sql. " +
        "Run `npm run check:deploy` to see everything that still needs setting.",
    );
    return false;
  }

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
