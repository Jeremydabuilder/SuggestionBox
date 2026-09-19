import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Request-scoped client that carries the signed-in president's session.
 * Every query it makes is subject to Row Level Security.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by the middleware instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS, so it is used only for the two jobs
 * that legitimately need it: writing a student's submission (which nobody is
 * signed in for) and the rate-limit / digest bookkeeping tables.
 *
 * This must never be imported into a Client Component.
 */
export function createSupabaseServiceClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
