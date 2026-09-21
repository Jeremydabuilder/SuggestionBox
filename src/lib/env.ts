/**
 * Server-side environment access.
 *
 * Nothing in this file may be imported from a Client Component — the only
 * values safe for the browser are the two NEXT_PUBLIC_* ones re-exported at
 * the bottom, which Next.js inlines at build time.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See README.md for setup.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get siteUrl() {
    const explicit = optional("NEXT_PUBLIC_SITE_URL");
    if (explicit) return explicit.replace(/\/$/, "");
    // Render sets RENDER_EXTERNAL_URL to the service's own address, scheme
    // included — the onrender.com address at first, and the custom domain
    // once one is attached and set as primary.
    const render = optional("RENDER_EXTERNAL_URL");
    if (render) return render.replace(/\/$/, "");
    return "http://localhost:3000";
  },
  get turnstileSecretKey() {
    return optional("TURNSTILE_SECRET_KEY");
  },
  get resendApiKey() {
    return optional("RESEND_API_KEY");
  },
  get digestFromEmail() {
    return optional("DIGEST_FROM_EMAIL");
  },
  /** Daily digest is OFF unless explicitly switched on. */
  get digestEnabled() {
    return (process.env.DIGEST_ENABLED ?? "").toLowerCase() === "true";
  },
  get cronSecret() {
    return optional("CRON_SECRET");
  },
  /** Salt for hashing IP addresses in the rate-limit log. */
  get ipHashSalt() {
    return optional("IP_HASH_SALT") ?? "suggestion-box-default-salt";
  },
  /** Optional, president-only weekly meeting agent. Never exposed client-side. */
  get groqApiKey() {
    return optional("GROQ_API_KEY");
  },
  /** Override if Groq retires the default model; no code change required. */
  get groqModel() {
    return optional("GROQ_MODEL");
  },
  /**
   * Optional: restrict student magic-link sign-in to one email domain (for
   * example "ourschool.org"). Unset by default — never hard-code a real
   * school's domain here. Compared case-insensitively, without the "@".
   */
  get studentEmailDomain() {
    return optional("STUDENT_EMAIL_DOMAIN")?.toLowerCase().replace(/^@/, "");
  },
} as const;

/** Safe for the browser — inlined by Next.js at build time. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  // Purely a UI hint (the actual restriction is enforced server-side in
  // requestStudentLink); safe to expose since it is just a domain name.
  studentEmailDomain: process.env.NEXT_PUBLIC_STUDENT_EMAIL_DOMAIN ?? "",
};
