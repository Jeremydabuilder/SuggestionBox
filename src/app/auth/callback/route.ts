import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedEmail } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import type { EmailOtpType } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only ever redirect to a path on this site. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/president";
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const supabase = await createSupabaseServerClient();

  let signedIn = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    signedIn = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    signedIn = !error;
  }

  if (!signedIn) {
    return NextResponse.redirect(
      new URL("/president/login?error=link", `${serverEnv.siteUrl}/`),
    );
  }

  // Signing in is not the same as being allowed in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAuthorizedEmail(user?.email))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/president/login?error=denied", `${serverEnv.siteUrl}/`),
    );
  }

  // Render terminates TLS in front of the Node process. Depending on proxy
  // headers, request.url can therefore have an internal localhost origin.
  // Redirecting against the configured public site URL keeps the magic-link
  // tab on the same public HTTPS host after the session cookie is written.
  return NextResponse.redirect(new URL(next, `${serverEnv.siteUrl}/`));
}
