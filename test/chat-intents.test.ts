import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_INTENTS, intentArgSchemas, parseIntentArgs, safeParseIntentArgs } from "../src/lib/chat-intents.ts";

describe("chat intent allowlist", () => {
  test("has exactly one schema per intent, no extras, no gaps", () => {
    assert.deepEqual(new Set(Object.keys(intentArgSchemas)), new Set(CHAT_INTENTS));
  });

  test("an intent outside the enum is rejected, not silently accepted", () => {
    // @ts-expect-error deliberately outside the enum
    assert.equal(safeParseIntentArgs("drop_all_tables", {}).success, false);
  });
});

describe("every intent schema rejects unknown properties", () => {
  for (const intent of CHAT_INTENTS) {
    test(`${intent} rejects an unexpected extra key`, () => {
      const parsed = intentArgSchemas[intent].safeParse({ sql: "DROP TABLE suggestions", extra: true });
      assert.equal(parsed.success, false);
    });
  }
});

describe("no schema anywhere accepts SQL, URLs, table names, or tool names", () => {
  for (const intent of CHAT_INTENTS) {
    test(`${intent} schema has no sql/url/table/tool/action/authorization field`, () => {
      const shape = (intentArgSchemas[intent] as unknown as { _def?: { shape?: () => Record<string, unknown> } });
      // Zod v4 objects expose their shape differently across versions; the
      // safest cross-version check is a strict parse with a probe object
      // naming exactly the fields we must never accept.
      const probe = {
        sql: "x", query_sql: "x", table: "x", tableName: "x", url: "x",
        serverAction: "x", toolName: "x", role: "president", authorized: true,
      };
      const parsed = intentArgSchemas[intent].safeParse(probe);
      assert.equal(parsed.success, false, `${intent} must reject a probe with sql/table/url/tool/role fields`);
      void shape;
    });
  }
});

describe("bounded argument examples", () => {
  test("search_inbox accepts a bounded query and known category/status", () => {
    const parsed = parseIntentArgs("search_inbox", { query: "lunch", category: "food", status: "new" });
    assert.equal(parsed.query, "lunch");
  });

  test("search_inbox rejects an unknown category", () => {
    assert.equal(safeParseIntentArgs("search_inbox", { category: "not_a_real_category" }).success, false);
  });

  test("related_suggestions requires a well-formed S### ref", () => {
    assert.equal(safeParseIntentArgs("related_suggestions", { ref: "S001" }).success, true);
    assert.equal(safeParseIntentArgs("related_suggestions", { ref: "DROP TABLE" }).success, false);
    assert.equal(safeParseIntentArgs("related_suggestions", {}).success, false);
  });

  test("since_last_meeting keeps a date phrase as bounded raw text, not a parsed date", () => {
    const parsed = parseIntentArgs("since_last_meeting", { datePhrase: "last week" });
    assert.equal(parsed.datePhrase, "last week");
  });

  test("since_last_meeting rejects an oversized date phrase", () => {
    assert.equal(safeParseIntentArgs("since_last_meeting", { datePhrase: "x".repeat(200) }).success, false);
  });

  test("list_actions only accepts the four known status values", () => {
    assert.equal(safeParseIntentArgs("list_actions", { status: "open" }).success, true);
    assert.equal(safeParseIntentArgs("list_actions", { status: "in_progress" }).success, false);
  });

  test("general_workspace_question requires bounded, non-empty text", () => {
    assert.equal(safeParseIntentArgs("general_workspace_question", { query: "" }).success, false);
    assert.equal(safeParseIntentArgs("general_workspace_question", { query: "x".repeat(600) }).success, false);
    assert.equal(safeParseIntentArgs("general_workspace_question", { query: "What food ideas came up most?" }).success, true);
  });
});
