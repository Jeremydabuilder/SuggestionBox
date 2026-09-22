import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEmailPreferences,
  EMAIL_SIGNOFF_MEMORY_PREFIX,
  EMAIL_SIGNATURE_MEMORY_PREFIX,
  EMAIL_STYLE_MEMORY_PREFIX,
  EMAIL_TONE_MEMORY_PREFIX,
  DEFAULT_EMAIL_SIGNOFF,
  DEFAULT_EMAIL_SIGNATURE,
  DEFAULT_EMAIL_STYLE,
  DEFAULT_EMAIL_TONE,
} from "../src/lib/email-preferences.ts";

function memory(text: string, updatedAt: string) {
  return { memoryText: text, updatedAt };
}

describe("email-preferences.ts — durable preferences read from ordinary chat_memories rows", () => {
  test("with no matching memory, every field falls back to its documented default", () => {
    const prefs = resolveEmailPreferences([]);
    assert.equal(prefs.signOff, DEFAULT_EMAIL_SIGNOFF);
    assert.equal(prefs.signature, DEFAULT_EMAIL_SIGNATURE);
    assert.equal(prefs.style, DEFAULT_EMAIL_STYLE);
    assert.equal(prefs.tone, DEFAULT_EMAIL_TONE);
  });

  test("a matching memory is read via its prefix", () => {
    const prefs = resolveEmailPreferences([
      memory(`${EMAIL_SIGNOFF_MEMORY_PREFIX}Warm regards`, "2026-01-01T00:00:00Z"),
      memory(`${EMAIL_SIGNATURE_MEMORY_PREFIX}Alex & Jordan, Co-Presidents`, "2026-01-01T00:00:00Z"),
    ]);
    assert.equal(prefs.signOff, "Warm regards");
    assert.equal(prefs.signature, "Alex & Jordan, Co-Presidents");
  });

  test("the most recently updated memory of a given kind wins", () => {
    const prefs = resolveEmailPreferences([
      memory(`${EMAIL_SIGNOFF_MEMORY_PREFIX}Old sign-off`, "2026-01-01T00:00:00Z"),
      memory(`${EMAIL_SIGNOFF_MEMORY_PREFIX}New sign-off`, "2026-06-01T00:00:00Z"),
    ]);
    assert.equal(prefs.signOff, "New sign-off");
  });

  test("style and tone are validated against their closed enum — an invalid value falls back to the default rather than being trusted", () => {
    const prefs = resolveEmailPreferences([
      memory(`${EMAIL_STYLE_MEMORY_PREFIX}extremely verbose`, "2026-01-01T00:00:00Z"),
      memory(`${EMAIL_TONE_MEMORY_PREFIX}sarcastic`, "2026-01-01T00:00:00Z"),
    ]);
    assert.equal(prefs.style, DEFAULT_EMAIL_STYLE);
    assert.equal(prefs.tone, DEFAULT_EMAIL_TONE);
  });

  test("a valid style and tone are accepted case-insensitively", () => {
    const prefs = resolveEmailPreferences([
      memory(`${EMAIL_STYLE_MEMORY_PREFIX}Concise`, "2026-01-01T00:00:00Z"),
      memory(`${EMAIL_TONE_MEMORY_PREFIX}Formal`, "2026-01-01T00:00:00Z"),
    ]);
    assert.equal(prefs.style, "concise");
    assert.equal(prefs.tone, "formal");
  });

  test("an unrelated memory (e.g. the agent's name) never affects email preferences", () => {
    const prefs = resolveEmailPreferences([memory("Agent name: Assistant", "2026-06-01T00:00:00Z")]);
    assert.equal(prefs.signOff, DEFAULT_EMAIL_SIGNOFF);
  });
});
