import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateAudioFile, AUDIO_LIMITS, ALLOWED_AUDIO_MIME_TYPES } from "../src/lib/audio-limits.ts";

describe("validateAudioFile", () => {
  test("accepts a small, allowed-type file", () => {
    const result = validateAudioFile({ size: 1024, type: "audio/webm" });
    assert.equal(result.ok, true);
  });

  test("rejects an empty file", () => {
    const result = validateAudioFile({ size: 0, type: "audio/webm" });
    assert.equal(result.ok, false);
  });

  test("rejects a file over the max upload size", () => {
    const result = validateAudioFile({ size: AUDIO_LIMITS.maxUploadBytes + 1, type: "audio/webm" });
    assert.equal(result.ok, false);
  });

  test("accepts a file exactly at the max upload size", () => {
    const result = validateAudioFile({ size: AUDIO_LIMITS.maxUploadBytes, type: "audio/webm" });
    assert.equal(result.ok, true);
  });

  test("rejects a disallowed MIME type", () => {
    const result = validateAudioFile({ size: 1024, type: "application/pdf" });
    assert.equal(result.ok, false);
  });

  test("strips a codec suffix before checking the type (e.g. audio/webm;codecs=opus)", () => {
    const result = validateAudioFile({ size: 1024, type: "audio/webm;codecs=opus" });
    assert.equal(result.ok, true);
  });

  test("every allowed MIME type in the list is actually accepted", () => {
    for (const type of ALLOWED_AUDIO_MIME_TYPES) {
      const result = validateAudioFile({ size: 1024, type });
      assert.equal(result.ok, true, `expected ${type} to be accepted`);
    }
  });

  test("maxRecordingMs and maxUploadBytes are both positive, sane bounds", () => {
    assert.ok(AUDIO_LIMITS.maxRecordingMs > 0);
    assert.ok(AUDIO_LIMITS.maxUploadBytes > 0);
    assert.ok(AUDIO_LIMITS.maxTranscriptChars > 0);
  });
});
