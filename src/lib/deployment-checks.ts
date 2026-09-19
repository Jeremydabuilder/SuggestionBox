/**
 * Pre-flight checks for a deployment.
 *
 * The one that matters most: the setup instructions ship with placeholder
 * co-president addresses, in both `.env.example` and the roster migration.
 * Deploying with those still in place produces a site that looks finished
 * and that NOBODY can sign in to — the placeholder domains are reserved by
 * RFC 2606 and cannot receive mail, so the sign-in link goes nowhere.
 *
 * Pure and dependency-free, so the same rules run in the pre-build script,
 * in the server at runtime, and in the tests.
 */

/** Domains reserved for documentation. No real address ever uses one. */
const PLACEHOLDER_DOMAINS = ["example.org", "example.com", "example.net"];

/** Addresses written into the setup files that a real deployment must replace. */
const PLACEHOLDER_LOCAL_PARTS = [
  "co-president-one",
  "co-president-two",
  "you@school.org",
];

export function isPlaceholderEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!value) return false;
  if (PLACEHOLDER_DOMAINS.some((domain) => value.endsWith(`@${domain}`))) return true;
  return PLACEHOLDER_LOCAL_PARTS.some(
    (part) => value === part || value.startsWith(`${part}@`),
  );
}

export function findPlaceholderEmails(emails: readonly string[]): string[] {
  return emails.filter(isPlaceholderEmail);
}

export interface DeploymentProblem {
  level: "error" | "warning";
  message: string;
  fix: string;
}

export interface DeploymentEnv {
  presidentEmails?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  serviceRoleKey?: string;
  siteUrl?: string;
  turnstileSecret?: string;
  ipHashSalt?: string;
  digestEnabled?: string;
  resendApiKey?: string;
  digestFrom?: string;
  cronSecret?: string;
}

export function parseEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Everything wrong with an environment, worst first.
 *
 * An environment with nothing configured at all is treated as a local build
 * rather than a broken deployment — that is the normal state of a fresh
 * checkout, and failing there would just be noise.
 */
export function describeDeploymentProblems(env: DeploymentEnv): DeploymentProblem[] {
  const problems: DeploymentProblem[] = [];
  const emails = parseEmails(env.presidentEmails);

  const placeholders = findPlaceholderEmails(emails);
  if (placeholders.length > 0) {
    problems.push({
      level: "error",
      message:
        `PRESIDENT_EMAILS still contains ${placeholders.length === 1 ? "a placeholder address" : "placeholder addresses"}: ` +
        placeholders.join(", "),
      fix:
        "Replace them with the real co-president addresses, in PRESIDENT_EMAILS and in " +
        "the authorized_presidents table. Nobody can sign in to /president until you do: " +
        "these domains are reserved for documentation and cannot receive the link.",
    });
  }

  if (emails.length > 0 && emails.length !== 2) {
    problems.push({
      level: "warning",
      message: `PRESIDENT_EMAILS lists ${emails.length} address${emails.length === 1 ? "" : "es"}, not 2.`,
      fix: "This box is built for exactly two co-presidents. Check the list is right.",
    });
  }

  const required: [string, string | undefined][] = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", env.serviceRoleKey],
    ["PRESIDENT_EMAILS", env.presidentEmails],
  ];
  for (const [name, value] of required) {
    if (!value) {
      problems.push({
        level: "error",
        message: `${name} is not set.`,
        fix: "Add it in Vercel under Project Settings -> Environment Variables.",
      });
    }
  }

  if (env.siteUrl && env.siteUrl.includes("localhost")) {
    problems.push({
      level: "error",
      message: `NEXT_PUBLIC_SITE_URL points at localhost (${env.siteUrl}).`,
      fix: "Set it to your real domain, or sign-in links will point at a laptop.",
    });
  }

  if (!env.turnstileSecret) {
    problems.push({
      level: "warning",
      message: "TURNSTILE_SECRET_KEY is not set, so bot protection is off.",
      fix: "Add Turnstile keys before students can reach the form.",
    });
  }

  if (!env.ipHashSalt) {
    problems.push({
      level: "warning",
      message: "IP_HASH_SALT is not set, so rate limiting falls back to a shared salt.",
      fix: "Set it to any long random string.",
    });
  }

  if ((env.digestEnabled ?? "").toLowerCase() === "true") {
    if (!env.resendApiKey || !env.digestFrom) {
      problems.push({
        level: "warning",
        message: "DIGEST_ENABLED is true but Resend is not fully configured.",
        fix: "Set RESEND_API_KEY and DIGEST_FROM_EMAIL, or set DIGEST_ENABLED=false.",
      });
    }
    if (!env.cronSecret) {
      problems.push({
        level: "warning",
        message: "DIGEST_ENABLED is true but CRON_SECRET is not set.",
        fix: "Without it the digest endpoint refuses every request, including Vercel's.",
      });
    }
  }

  return problems.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/** True when nothing at all is configured — a fresh checkout, not a deployment. */
export function looksUnconfigured(env: DeploymentEnv): boolean {
  return !env.supabaseUrl && !env.supabaseAnonKey && !env.serviceRoleKey && !env.presidentEmails;
}
