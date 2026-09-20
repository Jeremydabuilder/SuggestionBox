#!/usr/bin/env node
/**
 * Pre-deployment check. Runs automatically before `npm run build` (npm calls
 * a `prebuild` script on its own), so it runs on Render too. It can be run
 * on its own with `npm run check:deploy`.
 *
 * It fails the build on anything that would produce a site nobody can
 * administer — above all, no co-presidents set up in Supabase.
 *
 * Email privacy: the two real addresses live in one place, the
 * authorized_presidents table in your own Supabase project. This script
 * confirms they are THERE; it never needs them committed, never needs them
 * in deploy settings, and never prints one. A roster that looks wrong is
 * reported by count, and you look at your own SQL editor to see who is in
 * it. Only placeholders are ever named, and those came from this repository.
 *
 * A checkout with no environment at all is not a deployment, so it passes
 * quietly: that is just someone building locally.
 */
import {
  classifyRosterFailure,
  describeDeploymentProblems,
  describeRosterProblems,
  looksUnconfigured,
  supabaseHostname,
} from "../src/lib/deployment-checks.ts";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Render sets RENDER_EXTERNAL_URL itself; NEXT_PUBLIC_SITE_URL overrides it.
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.RENDER_EXTERNAL_URL,
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

/**
 * Ask Supabase who the co-presidents are. Returns only a shape — the rules
 * that judge it live in deployment-checks.ts.
 */
async function lookUpRoster(url, serviceKey) {
  if (!url || !serviceKey) return null;
  const hostname = supabaseHostname(url);
  if (!hostname) {
    return {
      status: "bad-endpoint",
      diagnostic: { message: "NEXT_PUBLIC_SUPABASE_URL is not a valid absolute URL." },
    };
  }
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/authorized_presidents?select=email`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return classifyRosterFailure(response.status, body, hostname);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      return {
        status: "unexpected-response",
        diagnostic: { hostname, httpStatus: response.status, message: "Expected a JSON array." },
      };
    }
    return { status: "ok", emails: rows.map((row) => String(row.email ?? "")).filter(Boolean) };
  } catch (error) {
    const message = error?.name === "AbortError" ? "Request timed out." : "Network request failed.";
    return { status: "unreachable", diagnostic: { hostname, message } };
  } finally {
    clearTimeout(timer);
  }
}

const problems = [...describeDeploymentProblems(env)];

const roster = await lookUpRoster(env.supabaseUrl, env.serviceRoleKey);
let rosterOk = false;
if (roster) {
  const rosterProblems = describeRosterProblems(roster);
  problems.push(...rosterProblems);
  rosterOk = roster.status === "ok" && rosterProblems.length === 0;
}

problems.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));

const errors = problems.filter((p) => p.level === "error");
const warnings = problems.filter((p) => p.level === "warning");

if (problems.length === 0) {
  console.log(
    `${GREEN}[deploy check] Environment looks ready. ` +
      `Two co-presidents are set up in Supabase.${OFF}`,
  );
  process.exit(0);
}

const line = "─".repeat(72);
console.log(`\n${line}`);
console.log(`${BOLD}Suggestion Box — deployment check${OFF}`);
console.log(line);

if (rosterOk) {
  console.log(`\n${GREEN}OK     ${OFF} Two co-presidents are set up in Supabase.`);
}

for (const problem of problems) {
  const colour = problem.level === "error" ? RED : YELLOW;
  const label = problem.level === "error" ? "ERROR  " : "WARNING";
  console.log(`\n${colour}${BOLD}${label}${OFF} ${problem.message}`);
  console.log(`        ${DIM}${problem.fix}${OFF}`);
  for (const detail of problem.details ?? []) {
    console.log(`        ${DIM}${detail}${OFF}`);
  }
}

console.log(`\n${line}`);
if (errors.length > 0) {
  console.log(
    `${RED}${BOLD}Build stopped: ${errors.length} error${errors.length === 1 ? "" : "s"}` +
      `${warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.${OFF}`,
  );
  console.log(`${DIM}See README.md, "Add the environment variables".${OFF}\n`);
  process.exit(1);
}

console.log(
  `${YELLOW}${warnings.length} warning${warnings.length === 1 ? "" : "s"}. The build will continue.${OFF}\n`,
);
process.exit(0);
