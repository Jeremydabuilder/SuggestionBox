import { NextResponse } from "next/server";
import { suggestionSchema, fieldErrors, LIMITS } from "@/lib/validation";
import { sanitizeLine, sanitizeText } from "@/lib/sanitize";
import { checkRateLimit, clientIpFrom, hashIp, recordSubmission } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
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

  // ---- 2. Sanitize before validating -------------------------------------
  const input = payload as Record<string, unknown>;
  const isAnonymous = input.isAnonymous === true;
  const cleaned = {
    title: sanitizeLine(input.title, LIMITS.title),
    description: sanitizeText(input.description, LIMITS.description),
    category: typeof input.category === "string" ? input.category : "",
    improvementReason: sanitizeText(input.improvementReason, LIMITS.improvementReason),
    isAnonymous,
    // An anonymous submission carries no identifying details at all.
    studentName: isAnonymous ? "" : sanitizeLine(input.studentName, LIMITS.name),
    studentEmail: isAnonymous
      ? ""
      : sanitizeLine(input.studentEmail, LIMITS.email).toLowerCase(),
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

  // ---- 3. Rate limit -----------------------------------------------------
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

  // ---- 4. Bot protection -------------------------------------------------
  const turnstile = await verifyTurnstile(value.turnstileToken, ip);
  if (!turnstile.ok) {
    return NextResponse.json(
      { error: "We couldn't confirm you're a person. Please refresh the page and try again." },
      { status: 403 },
    );
  }

  // ---- 5. Save -----------------------------------------------------------
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("suggestions")
    .insert({
      title: value.title,
      description: value.description,
      category: value.category,
      improvement_reason: value.improvementReason,
      student_name: value.studentName ? value.studentName : null,
      student_email: value.studentEmail ? value.studentEmail : null,
      is_anonymous: value.isAnonymous,
      status: "new",
      is_read: false,
    })
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
