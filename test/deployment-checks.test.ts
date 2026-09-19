import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  describeDeploymentProblems,
  findPlaceholderEmails,
  isPlaceholderEmail,
  looksUnconfigured,
  parseEmails,
} from "../src/lib/deployment-checks.ts";

const ready = {
  presidentEmails: "ada@westfield.school,ben@westfield.school",
  supabaseUrl: "https://abc.supabase.co",
  supabaseAnonKey: "anon",
  serviceRoleKey: "service",
  siteUrl: "https://suggestions.westfield.school",
  turnstileSecret: "turnstile",
  ipHashSalt: "salt",
};

describe("placeholder co-president addresses", () => {
  test("the addresses the setup files ship with are placeholders", () => {
    assert.ok(isPlaceholderEmail("co-president-one@example.org"));
    assert.ok(isPlaceholderEmail("co-president-two@example.org"));
    assert.ok(isPlaceholderEmail("you@school.org"));
  });

  test("any reserved documentation domain counts", () => {
    assert.ok(isPlaceholderEmail("ada@example.com"));
    assert.ok(isPlaceholderEmail("ada@example.net"));
  });

  test("case and surrounding spaces do not hide one", () => {
    assert.ok(isPlaceholderEmail("  Co-President-One@Example.ORG  "));
  });

  test("a real school address is not a placeholder", () => {
    assert.ok(!isPlaceholderEmail("ada@westfield.school"));
    assert.ok(!isPlaceholderEmail("ada.lovelace@westfield.sch.uk"));
  });

  test("a domain that merely contains 'example' is not a placeholder", () => {
    assert.ok(!isPlaceholderEmail("ada@exampleacademy.org"));
  });

  test("they are picked out of a list", () => {
    assert.deepEqual(
      findPlaceholderEmails(["ada@westfield.school", "co-president-two@example.org"]),
      ["co-president-two@example.org"],
    );
  });
});

describe("the deployment check", () => {
  test("a ready environment has nothing to report", () => {
    assert.deepEqual(describeDeploymentProblems(ready), []);
  });

  test("a placeholder address is an ERROR, not a warning", () => {
    const problems = describeDeploymentProblems({
      ...ready,
      presidentEmails: "co-president-one@example.org,co-president-two@example.org",
    });
    const placeholder = problems.find((p) => p.message.includes("placeholder"));
    assert.ok(placeholder, "expected a placeholder problem");
    assert.equal(placeholder.level, "error");
    assert.match(placeholder.message, /co-president-one@example\.org/);
    assert.match(placeholder.fix, /authorized_presidents/);
  });

  test("one real and one placeholder address still errors", () => {
    const problems = describeDeploymentProblems({
      ...ready,
      presidentEmails: "ada@westfield.school,co-president-two@example.org",
    });
    assert.ok(problems.some((p) => p.level === "error" && p.message.includes("placeholder")));
  });

  test("errors are listed before warnings", () => {
    const problems = describeDeploymentProblems({
      presidentEmails: "co-president-one@example.org",
      supabaseUrl: "https://abc.supabase.co",
      supabaseAnonKey: "anon",
    });
    const firstWarning = problems.findIndex((p) => p.level === "warning");
    const lastError = problems.map((p) => p.level).lastIndexOf("error");
    assert.ok(firstWarning === -1 || lastError < firstWarning);
  });

  test("a site URL pointing at localhost is an error", () => {
    const problems = describeDeploymentProblems({ ...ready, siteUrl: "http://localhost:3000" });
    assert.ok(problems.some((p) => p.level === "error" && p.message.includes("localhost")));
  });

  test("missing required variables are errors", () => {
    const problems = describeDeploymentProblems({ ...ready, serviceRoleKey: undefined });
    assert.ok(
      problems.some((p) => p.level === "error" && p.message.includes("SUPABASE_SERVICE_ROLE_KEY")),
    );
  });

  test("a digest turned on without Resend only warns", () => {
    const problems = describeDeploymentProblems({ ...ready, digestEnabled: "true" });
    assert.ok(problems.length > 0);
    assert.ok(problems.every((p) => p.level === "warning"));
  });

  test("an empty checkout is a local build, not a broken deployment", () => {
    assert.ok(looksUnconfigured({}));
    assert.ok(!looksUnconfigured({ presidentEmails: "ada@westfield.school" }));
  });

  test("email parsing tolerates spacing and case", () => {
    assert.deepEqual(parseEmails(" Ada@School.org , ben@school.org ,, "), [
      "ada@school.org",
      "ben@school.org",
    ]);
  });
});
