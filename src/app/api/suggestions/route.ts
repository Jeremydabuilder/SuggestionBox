import { NextResponse } from "next/server";
import { suggestionSchema, fieldErrors, LIMITS } from "@/lib/validation";
import { sanitizeLine, sanitizeText } from "@/lib/sanitize";
import { checkRateLimit, clientIpFrom, hashIp, recordSubmission } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { detectDuplicatesFor } from "@/lib/duplicates/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 24 * 1024;

export async function POST(request: Request) {
  // ---- 1. Parse the body defensively -------------------------------------
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That submission is too large." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "We couldn't read that submission." }, { status: 400 });
  }

  // Honeypot: a real student never fills a field they cannot see.
  if (typeof payload === "object" && payload !== null) {
    const hp = (payload as Record<string, unknown>).website;
    if (typeof hp === "string" && hp.trim().length > 0) {
      // Silently accept-looking rejection so bots learn nothing.
      return NextResponse.json({ error: "We couldn't accept that submission." }, { status: 400 });
    }
  }

  // ---- 2. Sanitize before validating --------------------------------------
  // studentEmail is deliberately never read from the client here — the
  // verified session's own email is the only source, checked in step 5.
  const input = payload as Record<string, unknown>;
  const cleaned = {
    title: sanitizeLine(input.title, LIMITS.title),
    description: sanitizeText(input.description, LIMITS.description),
    category: typeof input.category === "string" ? input.category : "",
    improvementReason: sanitizeText(input.improvementReason, LIMITS.improvementReason),
    studentName: sanitizeLine(input.studentName, LIMITS.name),
    turnstileToken: typeof input.turnstileToken === "string" ? input.turnstileToken : undefined,
  };

  const parsed = suggestionSchema.safeParse(cleaned);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the highlighted fields.", fields: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }
  const value = parsed.data;

  // ---- 3. Require a verified, signed-in student ---------------------------
  // Every new suggestion needs a real, Supabase-verified identity. The name
  // above is the only thing we take the student's word for; the email comes
  // only from the session Supabase itself vouches for.
  const sessionClient = await createSupabaseServerClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user?.email) {
    return NextResponse.json(
      { error: "Sign in with your school email before submitting an idea.", code: "sign_in_required" },
      { status: 401 },
    );
  }

  // ---- 4. Rate limit -------------------------------------------------------
  const ip = clientIpFrom(request.headers);
  const ipHash = hashIp(ip);
  const limit = await checkRateLimit(ipHash);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "You've sent a few ideas already. Give it a little while, then try again — we've got them.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // ---- 5. Bot protection ---------------------------------------------------
  const turnstile = await verifyTurnstile(value.turnstileToken, ip);
  if (!turnstile.ok) {
    return NextResponse.json(
      { error: "We couldn't confirm you're a person. Please refresh the page and try again." },
      { status: 403 },
    );
  }

  // ---- 6. Save ---------------------------------------------------------
  // Inserted on the SESSION client, not the service client: this is what
  // makes the RLS policy from 20260923000000_verified_student_identity.sql
  // actually run against this request, on top of the checks above. The
  // student's own verified email — never anything the client sent — is what
  // gets stored.
  const row = {
    title: value.title,
    description: value.description,
    category: value.category,
    improvement_reason: value.improvementReason,
    student_name: value.studentName,
    student_email: user.email.toLowerCase(),
    is_anonymous: false,
    submitter_user_id: user.id,
    status: "new",
    is_read: false,
  };
  const { data, error } = await sessionClient
    .from("suggestions")
    .insert(row)
    .select("id, created_at")
    .single();

  if (error || !data) {
    console.error("[suggestions] insert failed:", error?.message);
    return NextResponse.json(
      { error: "Something went wrong saving your idea. Please try again in a moment." },
      { status: 500 },
    );
  }

  await recordSubmission(ipHash);

  // Look for possible duplicates and note them for the presidents.
  //
  // This is advisory and must never affect the student: it cannot change
  // what was saved, and if it fails the submission still succeeded, so the
  // error is logged and swallowed rather than surfaced. A president can
  // always re-run the scan from the dashboard.
  try {
    await detectDuplicatesFor(data.id);
  } catch (duplicateError) {
    console.error("[suggestions] duplicate scan failed:", duplicateError);
  }

  // No email is sent here by design: the president dashboard is the inbox.
  return NextResponse.json({ id: data.id, createdAt: data.created_at }, { status: 201 });
}
