import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRosterFailure,
  diagnosticLines,
  describeDeploymentProblems,
  describeRosterProblems,
  findPlaceholderEmails,
  isPlaceholderEmail,
  looksUnconfigured,
  parseEmails,
  parseSupabaseErrorBody,
  supabaseHostname,
  type RosterLookup,
} from "../src/lib/deployment-checks.ts";

const ready = {
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

  test("errors are listed before warnings", () => {
    const problems = describeDeploymentProblems({
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
    assert.ok(!looksUnconfigured({ supabaseUrl: "https://abc.supabase.co" }));
  });

  test("email parsing tolerates spacing and case", () => {
    assert.deepEqual(parseEmails(" Ada@School.org , ben@school.org ,, "), [
      "ada@school.org",
      "ben@school.org",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* The roster in Supabase is the one list of co-presidents             */
/* ------------------------------------------------------------------ */

describe("checking the co-presidents in Supabase", () => {
  test("two real addresses is a clean bill of health", () => {
    assert.deepEqual(
      describeRosterProblems({
        status: "ok",
        emails: ["ada@westfield.school", "ben@westfield.school"],
      }),
      [],
    );
  });

  test("an empty roster is an error — nobody could sign in", () => {
    const [problem] = describeRosterProblems({ status: "ok", emails: [] });
    assert.equal(problem.level, "error");
    assert.match(problem.message, /No co-presidents/);
  });

  test("placeholders left in the table are an error", () => {
    const [problem] = describeRosterProblems({
      status: "ok",
      emails: ["co-president-one@example.org", "co-president-two@example.org"],
    });
    assert.equal(problem.level, "error");
    assert.match(problem.message, /placeholder addresses/);
  });

  test("a missing table points at the migrations", () => {
    const [problem] = describeRosterProblems({
      status: "missing-table",
      diagnostic: { httpStatus: 404, code: "PGRST205" },
    });
    assert.equal(problem.level, "error");
    assert.match(problem.fix, /supabase\/migrations/);
  });

  test("a rejected service-role key is an error", () => {
    const [problem] = describeRosterProblems({
      status: "unauthorized",
      diagnostic: { httpStatus: 401 },
    });
    assert.equal(problem.level, "error");
    assert.match(problem.fix, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  test("being unable to reach Supabase only warns, so a blip cannot block a deploy", () => {
    const [problem] = describeRosterProblems({
      status: "unreachable",
      diagnostic: { message: "Request timed out." },
    });
    assert.equal(problem.level, "warning");
  });

  test("a roster that is not exactly two warns", () => {
    const [problem] = describeRosterProblems({
      status: "ok",
      emails: ["ada@westfield.school"],
    });
    assert.equal(problem.level, "warning");
    assert.match(problem.message, /1 authorized presidents/);
  });

  // The privacy guarantee, asserted rather than promised: whatever the
  // roster looks like, no real address ends up in a build log.
  test("no message or fix ever contains a real address", () => {
    const real = ["ada@westfield.school", "ben@westfield.school", "cara@westfield.school"];
    const lookups: RosterLookup[] = [
      { status: "ok", emails: real },
      { status: "ok", emails: real.slice(0, 1) },
      { status: "ok", emails: [...real, "co-president-one@example.org"] },
      { status: "unauthorized", diagnostic: { httpStatus: 401 } },
      { status: "missing-table", diagnostic: { httpStatus: 404, code: "PGRST205" } },
      { status: "unreachable", diagnostic: { message: "Request timed out." } },
    ];
    for (const lookup of lookups) {
      for (const problem of describeRosterProblems(lookup)) {
        const text = `${problem.message} ${problem.fix}`;
        for (const address of real) {
          assert.ok(
            !text.includes(address),
            `leaked ${address} in: ${text}`,
          );
        }
      }
    }
  });
});

describe("classifying Supabase Data API failures", () => {
  test("PGRST205 is the only 404 diagnosed as a missing table", () => {
    const body = JSON.stringify({
      code: "PGRST205",
      message: "Could not find the table 'public.authorized_presidents' in the schema cache",
      details: null,
      hint: null,
    });
    assert.equal(classifyRosterFailure(404, body, "abc.supabase.co").status, "missing-table");
  });

  test("a generic 404 is diagnosed as a bad endpoint, not a missing table", () => {
    assert.equal(classifyRosterFailure(404, "Not Found", "abc.supabase.co").status, "bad-endpoint");
  });

  test("authorization failures stay distinct", () => {
    assert.equal(
      classifyRosterFailure(401, JSON.stringify({ message: "Invalid API key" })).status,
      "unauthorized",
    );
  });

  test("safe PostgREST fields and the public hostname are retained", () => {
    const parsed = parseSupabaseErrorBody(JSON.stringify({
      code: "PGRST301",
      message: "JWT expired",
      details: "detail",
      hint: "refresh",
      secret: "must not be copied",
    }));
    assert.deepEqual(parsed, {
      code: "PGRST301",
      message: "JWT expired",
      details: "detail",
      hint: "refresh",
    });
    assert.equal(supabaseHostname("https://abc.supabase.co"), "abc.supabase.co");
    assert.deepEqual(
      diagnosticLines({ hostname: "abc.supabase.co", httpStatus: 400, ...parsed }),
      [
        "Supabase host: abc.supabase.co",
        "HTTP status: 400",
        "Supabase code: PGRST301",
        "Message: JWT expired",
        "Details: detail",
        "Hint: refresh",
      ],
    );
  });
});
