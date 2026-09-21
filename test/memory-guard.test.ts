import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkMemoryContent } from "../src/lib/memory-guard.ts";

describe("checkMemoryContent — rejects secrets and identity-shaped text", () => {
  test("allows an ordinary preference", () => {
    assert.equal(checkMemoryContent("Weekly meeting is Fridays at 3pm").allowed, true);
  });

  test("rejects an email address", () => {
    assert.equal(checkMemoryContent("Contact jordan.r@school.org about lunch").allowed, false);
  });

  test("rejects something shaped like an API key", () => {
    assert.equal(checkMemoryContent("Key is gsk_abcd1234efgh5678ijkl").allowed, false);
  });

  test("rejects a bearer token", () => {
    assert.equal(checkMemoryContent("Authorization: Bearer abcdef0123456789").allowed, false);
  });

  test("rejects text naming a password", () => {
    assert.equal(checkMemoryContent("password: hunter22isgreat").allowed, false);
  });

  test("rejects an IP address", () => {
    assert.equal(checkMemoryContent("Server is at 192.168.1.42 for reference").allowed, false);
  });

  test("rejects a long digit run (phone/SSN/card shaped)", () => {
    assert.equal(checkMemoryContent("Call 555-123-4567 for details").allowed, false);
  });

  test("rejects a long opaque token-like string", () => {
    assert.equal(checkMemoryContent("Token: aB3dE7fG9hJ2kL5mN8pQ1rS4tU6vW0xY").allowed, false);
  });

  test("ordinary short numbers (like a room number) are allowed", () => {
    assert.equal(checkMemoryContent("Meetings are in Room 204").allowed, true);
  });
});
