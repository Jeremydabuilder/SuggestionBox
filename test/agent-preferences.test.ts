import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RESPONSE_STYLE,
  RESPONSE_STYLES,
  responseStyleMemoryText,
  isResponseStyleMemory,
  resolveResponseStyle,
  findResponseStyleMemory,
} from "../src/lib/agent-preferences.ts";

describe("response style memory convention", () => {
  test("responseStyleMemoryText/isResponseStyleMemory round-trip", () => {
    const text = responseStyleMemoryText("concise");
    assert.equal(text, "Response style: concise");
    assert.equal(isResponseStyleMemory(text), true);
  });

  test("an ordinary memory is never mistaken for a response-style memory", () => {
    assert.equal(isResponseStyleMemory("Weekly meeting is Fridays"), false);
  });

  test("every RESPONSE_STYLES value round-trips through resolveResponseStyle", () => {
    for (const style of RESPONSE_STYLES) {
      const resolved = resolveResponseStyle([{ memoryText: responseStyleMemoryText(style), updatedAt: "2026-01-01T00:00:00.000Z" }]);
      assert.equal(resolved, style);
    }
  });
});

describe("resolveResponseStyle", () => {
  test("falls back to DEFAULT_RESPONSE_STYLE with no matching memory", () => {
    assert.equal(resolveResponseStyle([]), DEFAULT_RESPONSE_STYLE);
  });

  test("an invalid stored value fails closed to the default", () => {
    assert.equal(
      resolveResponseStyle([{ memoryText: "Response style: verbose_and_dangerous", updatedAt: "2026-01-01T00:00:00.000Z" }]),
      DEFAULT_RESPONSE_STYLE,
    );
  });

  test("the most recently updated style memory wins", () => {
    const resolved = resolveResponseStyle([
      { memoryText: responseStyleMemoryText("detailed"), updatedAt: "2026-01-01T00:00:00.000Z" },
      { memoryText: responseStyleMemoryText("concise"), updatedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    assert.equal(resolved, "concise");
  });
});

describe("findResponseStyleMemory", () => {
  test("returns null when none exists", () => {
    assert.equal(findResponseStyleMemory([]), null);
  });

  test("returns the latest one", () => {
    const older = { id: "a", memoryText: responseStyleMemoryText("detailed"), updatedAt: "2026-01-01T00:00:00.000Z" };
    const newer = { id: "b", memoryText: responseStyleMemoryText("concise"), updatedAt: "2026-02-01T00:00:00.000Z" };
    assert.equal(findResponseStyleMemory([older, newer])?.id, "b");
  });
});
