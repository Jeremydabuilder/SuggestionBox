/**
 * Pre-flight checks for a deployment.
 *
 * The check that matters most is that the two co-presidents actually exist
 * in Supabase. Deploying without them produces a site that looks completely
 * finished and that nobody can sign in to.
 *
 * That check reads the roster out of Supabase rather than out of an
 * environment variable, so the two real addresses never have to be
 * committed, put in deploy settings, or printed in a build log. The rules
 * below never put a real address into a message — only a placeholder, which
 * is safe by definition because it came from this file.
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
 * What a lookup of the authorized_presidents table came back with.
 *
 * The script does the network call; these are the shapes it can produce, so
 * the rules that interpret them stay pure and testable.
 */
export type RosterLookup =
  | { status: "ok"; emails: string[] }
  | { status: "unauthorized"; detail: string }
  | { status: "missing-table"; detail: string }
  | { status: "unreachable"; detail: string };

/**
 * Judge the roster.
 *
 * Deliberately never names a real address: a wrong-looking roster is
 * reported by COUNT, and the operator looks at their own SQL editor to see
 * who is in it. Only placeholders are named, and those are ours.
 */
export function describeRosterProblems(lookup: RosterLookup): DeploymentProblem[] {
  if (lookup.status === "unauthorized") {
    return [
      {
        level: "error",
        message: `Supabase refused the service-role key (${lookup.detail}).`,
        fix: "Check SUPABASE_SERVICE_ROLE_KEY against Project Settings -> API Keys.",
      },
    ];
  }

  if (lookup.status === "missing-table") {
    return [
      {
        level: "error",
        message: "The authorized_presidents table does not exist in Supabase.",
        fix:
          "Run the files in supabase/migrations/ in the Supabase SQL Editor, " +
          "oldest first.",
      },
    ];
  }

  if (lookup.status === "unreachable") {
    return [
      {
        level: "warning",
        message: `Could not reach Supabase to check the co-presidents (${lookup.detail}).`,
        fix:
          "The build will continue. Run `npm run check:deploy` once it is " +
          "reachable, or confirm the roster in the Supabase SQL Editor.",
      },
    ];
  }

  const placeholders = findPlaceholderEmails(lookup.emails);
  if (placeholders.length > 0) {
    return [
      {
        level: "error",
        message:
          "The authorized_presidents table still holds " +
          `${placeholders.length === 1 ? "a placeholder address" : "placeholder addresses"}: ` +
          placeholders.join(", "),
        fix:
          "Replace them with the real co-president addresses using " +
          "supabase/maintenance/add_presidents.sql. Nobody can sign in to " +
          "/president until you do: these domains are reserved for " +
          "documentation and cannot receive the sign-in link.",
      },
    ];
  }

  if (lookup.emails.length === 0) {
    return [
      {
        level: "error",
        message: "No co-presidents are set up in Supabase.",
        fix:
          "Add the two of them with supabase/maintenance/add_presidents.sql. " +
          "Until you do, nobody can sign in to /president.",
      },
    ];
  }

  if (lookup.emails.length !== 2) {
    return [
      {
        level: "warning",
        message: `Supabase lists ${lookup.emails.length} authorized presidents, not 2.`,
        fix:
          "This box is built for exactly two co-presidents. Check the roster " +
          "in the Supabase SQL Editor — the addresses are not printed here.",
      },
    ];
  }

  return [];
}

export function describeDeploymentProblems(env: DeploymentEnv): DeploymentProblem[] {
  const problems: DeploymentProblem[] = [];

  const required: [string, string | undefined][] = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", env.serviceRoleKey],
  ];
  for (const [name, value] of required) {
    if (!value) {
      problems.push({
        level: "error",
        message: `${name} is not set.`,
        fix: "Add it in Render under your service -> Environment.",
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
        fix: "Without it the digest endpoint refuses every request, including the scheduled one.",
      });
    }
  }

  return problems.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/** True when nothing at all is configured — a fresh checkout, not a deployment. */
export function looksUnconfigured(env: DeploymentEnv): boolean {
  return !env.supabaseUrl && !env.supabaseAnonKey && !env.serviceRoleKey;
}
