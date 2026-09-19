import "server-only";
import { serverEnv } from "@/lib/env";
import { escapeHtml } from "@/lib/sanitize";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, type Category } from "@/lib/types";

export type DigestOutcome =
  | { sent: false; reason: string }
  | { sent: true; unreadCount: number; recipients: number };

/** Recipients come from the roster table — the one list of co-presidents. */
async function digestRecipients(): Promise<string[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("authorized_presidents").select("email");
  if (error) {
    console.error("[digest] roster lookup failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => String(r.email).toLowerCase());
}

/**
 * Sends at most one summary email per day, and only when unread suggestions
 * are actually waiting. Disabled unless DIGEST_ENABLED=true.
 */
export async function runDailyDigest(): Promise<DigestOutcome> {
  if (!serverEnv.digestEnabled) return { sent: false, reason: "digest-disabled" };

  const apiKey = serverEnv.resendApiKey;
  const from = serverEnv.digestFromEmail;
  if (!apiKey || !from) return { sent: false, reason: "resend-not-configured" };

  const service = createSupabaseServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // One per calendar day: claim the day first, so a retry cannot double-send.
  const { error: claimError } = await service
    .from("digest_runs")
    .insert({ sent_for: today, unread_count: 0 });
  if (claimError) {
    if (claimError.code === "23505") return { sent: false, reason: "already-sent-today" };
    console.error("[digest] could not claim today:", claimError.message);
    return { sent: false, reason: "claim-failed" };
  }

  const { data: unread, error } = await service
    .from("suggestions")
    .select("id, title, category, created_at")
    .eq("is_read", false)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    console.error("[digest] unread lookup failed:", error.message);
    return { sent: false, reason: "query-failed" };
  }

  const rows = unread ?? [];
  if (rows.length === 0) {
    // Nothing to say — release the claim so a later run today can still send.
    await service.from("digest_runs").delete().eq("sent_for", today);
    return { sent: false, reason: "no-unread-suggestions" };
  }

  const recipients = await digestRecipients();
  if (recipients.length === 0) return { sent: false, reason: "no-recipients" };

  const panelUrl = `${serverEnv.siteUrl}/president`;
  const items = rows
    .map(
      (r) =>
        `<li style="margin:0 0 10px 0;"><strong style="color:#101935;">${escapeHtml(
          String(r.title),
        )}</strong><br/><span style="color:#5b6480;font-size:13px;">${escapeHtml(
          CATEGORY_LABELS[r.category as Category] ?? String(r.category),
        )}</span></li>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#FBF7F0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #E8DFD2;border-radius:14px;padding:28px;">
    <p style="margin:0 0 4px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E24E1B;">Suggestion Box</p>
    <h1 style="margin:0 0 16px 0;font-size:22px;color:#101935;">${rows.length} unread suggestion${
      rows.length === 1 ? "" : "s"
    }</h1>
    <ul style="padding-left:18px;margin:0 0 24px 0;">${items}</ul>
    <a href="${escapeHtml(panelUrl)}" style="display:inline-block;background:#E24E1B;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;">Open the dashboard</a>
    <p style="margin:22px 0 0 0;font-size:12px;color:#8a93a8;">Read and manage every suggestion in the dashboard — this email is only a heads-up.</p>
  </div></body></html>`;

  const text = [
    `${rows.length} unread suggestion${rows.length === 1 ? "" : "s"}`,
    "",
    ...rows.map(
      (r) => `- ${r.title} (${CATEGORY_LABELS[r.category as Category] ?? r.category})`,
    ),
    "",
    `Open the dashboard: ${panelUrl}`,
  ].join("\n");

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from,
      to: recipients,
      subject: `Suggestion Box — ${rows.length} unread`,
      html,
      text,
    });
    if (sendError) {
      console.error("[digest] send failed:", sendError.message);
      await service.from("digest_runs").delete().eq("sent_for", today);
      return { sent: false, reason: "send-failed" };
    }
  } catch (err) {
    console.error("[digest] send threw:", err);
    await service.from("digest_runs").delete().eq("sent_for", today);
    return { sent: false, reason: "send-failed" };
  }

  await service.from("digest_runs").update({ unread_count: rows.length }).eq("sent_for", today);
  return { sent: true, unreadCount: rows.length, recipients: recipients.length };
}
