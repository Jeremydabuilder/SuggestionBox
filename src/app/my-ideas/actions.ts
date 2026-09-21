"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { LIMITS } from "@/lib/validation";

export async function requestStudentLink(
  _previous: unknown,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, LIMITS.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, message: "Enter a valid school email address." };
  }

  const domain = serverEnv.studentEmailDomain;
  if (domain && !email.endsWith(`@${domain}`)) {
    return { ok: false, message: `Use your school email address (must end in @${domain}).` };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${serverEnv.siteUrl}/auth/callback?next=/my-ideas`,
    },
  });
  if (error) {
    console.error("[student auth] magic link failed:", error.message);
    return { ok: false, message: "We couldn’t send the link just now. Try again in a moment." };
  }
  return { ok: true, message: "Check your inbox for a one-time sign-in link." };
}

export async function signOutStudent(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
