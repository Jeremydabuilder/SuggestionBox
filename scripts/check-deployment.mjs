#!/usr/bin/env node
/**
 * Pre-deployment check. Runs automatically before `npm run build` (npm calls
 * a `prebuild` script on its own), and can be run on its own with
 * `npm run check:deploy`.
 *
 * It fails the build on anything that would produce a site nobody can
 * administer — above all, co-president addresses still set to the
 * placeholders the setup instructions ship with.
 *
 * A checkout with no environment at all is not a deployment, so it passes
 * quietly: that is just someone building locally.
 */
import { describeDeploymentProblems, looksUnconfigured } from "../src/lib/deployment-checks.ts";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

const env = {
  presidentEmails: process.env.PRESIDENT_EMAILS,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY,
  ipHashSalt: process.env.IP_HASH_SALT,
  digestEnabled: process.env.DIGEST_ENABLED,
  resendApiKey: process.env.RESEND_API_KEY,
  digestFrom: process.env.DIGEST_FROM_EMAIL,
  cronSecret: process.env.CRON_SECRET,
};

if (looksUnconfigured(env)) {
  console.log(
    `${DIM}[deploy check] No environment configured — treating this as a local build and skipping.${OFF}`,
  );
  process.exit(0);
}

const problems = describeDeploymentProblems(env);
const errors = problems.filter((p) => p.level === "error");
const warnings = problems.filter((p) => p.level === "warning");

if (problems.length === 0) {
  console.log(`${GREEN}[deploy check] Environment looks ready.${OFF}`);
  process.exit(0);
}

const line = "─".repeat(72);
console.log(`\n${line}`);
console.log(`${BOLD}Suggestion Box — deployment check${OFF}`);
console.log(line);

for (const problem of problems) {
  const colour = problem.level === "error" ? RED : YELLOW;
  const label = problem.level === "error" ? "ERROR  " : "WARNING";
  console.log(`\n${colour}${BOLD}${label}${OFF} ${problem.message}`);
  console.log(`        ${DIM}${problem.fix}${OFF}`);
}

console.log(`\n${line}`);
if (errors.length > 0) {
  console.log(
    `${RED}${BOLD}Build stopped: ${errors.length} error${errors.length === 1 ? "" : "s"}` +
      `${warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.${OFF}`,
  );
  console.log(`${DIM}See README.md, "Add all required environment variables".${OFF}\n`);
  process.exit(1);
}

console.log(
  `${YELLOW}${warnings.length} warning${warnings.length === 1 ? "" : "s"}. The build will continue.${OFF}\n`,
);
process.exit(0);
