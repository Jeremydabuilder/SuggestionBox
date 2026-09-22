import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Stage 10: a whole-tree sweep, not another single-file guard test.
 * Every individual chat/president file already has its own guard tests
 * (chat-router-guard, chat-orchestration-guard, since-last-meeting-guard,
 * inbox-search-guard, chat-inbox-answer-guard, chat-proposal-communication-guard,
 * meeting-transcription-guard) — this file exists so a FUTURE file that
 * forgets one of those same rules still gets caught, without needing its
 * own bespoke test written for it every time.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function listFilesRecursive(dir: string, exts: string[]): string[] {
  const entries = readdirSync(`${ROOT}${dir}`, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listFilesRecursive(path, exts);
    return exts.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

const componentFiles = listFilesRecursive("src/components", [".ts", ".tsx"]);
const presidentActionFiles = listFilesRecursive("src/app/president", [".ts"]);

describe("no client component ever touches Supabase or the service-role client directly", () => {
  for (const file of componentFiles) {
    test(`${file} has no direct Supabase client import`, () => {
      const source = read(file);
      assert.doesNotMatch(source, /createSupabaseServerClient|createSupabaseServiceClient/, `${file} must go through a server action instead`);
    });
  }
});

describe("the service-role client is confined to chat-assistant-internal.ts across the whole president app surface", () => {
  const filesUsingServiceClient = presidentActionFiles.filter((file) => read(file).includes("createSupabaseServiceClient"));

  test("createSupabaseServiceClient is imported in exactly one file", () => {
    assert.deepEqual(filesUsingServiceClient, ["src/app/president/chat-assistant-internal.ts"]);
  });
});

describe("no owner/assignee field anywhere in the workspace data model or its server actions", () => {
  const candidateFiles = [
    ...listFilesRecursive("src/app/president", [".ts"]),
    ...listFilesRecursive("src/lib", [".ts"]),
    ...componentFiles,
  ];

  for (const file of candidateFiles) {
    test(`${file} never reads/writes an owner, assignee, or assigned_to field`, () => {
      const body = stripComments(read(file));
      assert.doesNotMatch(body, /\bowner\b|\bassignee\b|\bassigned_to\b/i, `${file} must not introduce an owner/assignee field`);
    });
  }
});

describe("no Server Action under src/app/president reads req/res identity from its own parameters instead of getPresidentSession()", () => {
  const serverActionFiles = presidentActionFiles.filter((file) => stripComments(read(file)).includes('"use server"'));

  test("every 'use server' file under src/app/president calls getPresidentSession at least once", () => {
    for (const file of serverActionFiles) {
      const source = read(file);
      assert.match(source, /getPresidentSession\(\)/, `${file} is a Server Action but never calls getPresidentSession()`);
    }
  });

  test("there are at least the expected number of 'use server' files (sanity check the scan itself found real files)", () => {
    assert.ok(serverActionFiles.length >= 13, `expected at least 13 Server Action files, found ${serverActionFiles.length}`);
  });
});

describe("no raw fetch/webhook call anywhere reachable from the browser could exfiltrate workspace data", () => {
  for (const file of componentFiles) {
    test(`${file} makes no direct fetch() call to an external URL`, () => {
      const body = stripComments(read(file));
      // Server Actions and internal navigation are fine; a literal http(s):// fetch from a component is not.
      assert.doesNotMatch(body, /fetch\(\s*["'`]https?:\/\//, `${file} must not fetch an external URL directly from the client`);
    });
  }
});

describe("console logging never carries raw message/transcript/suggestion content", () => {
  const filesWithConsoleInfo = presidentActionFiles.filter((file) => read(file).includes("console.info("));

  test("every console.info call site outside chat-router.ts logs only an already-reviewed metadata object, not raw text", () => {
    for (const file of filesWithConsoleInfo) {
      if (file === "src/app/president/chat-router.ts") continue; // covered by its own dedicated test
      const source = read(file);
      const calls = [...source.matchAll(/console\.info\(([^)]*)\)/g)].map((m) => m[1]);
      for (const call of calls) {
        assert.doesNotMatch(call!, /rawContent|rawMessage|transcript|question|pastedText/, `${file} logs something that looks like raw content: ${call}`);
      }
    }
  });
});

describe("every Groq-calling module bounds its request count and is covered by its own bounds test", () => {
  const groqCallers = [
    "src/app/president/chat-router.ts",
    "src/app/president/chat-inbox-answer.ts",
    "src/app/president/chat-proposal-builder.ts",
    "src/app/president/chat-communication-draft.ts",
    "src/app/president/chat-cleanup-review.ts",
  ];

  for (const file of groqCallers) {
    test(`${file} calls exactly one of the bounded completion functions exactly once`, () => {
      const source = read(file);
      const classifierCalls = (source.match(/generateClassifierCompletion\(/g) ?? []).length;
      const answerCalls = (source.match(/generateAnswerCompletion\(/g) ?? []).length;
      assert.equal(classifierCalls + answerCalls, 1, `${file} should call exactly one bounded Groq completion function exactly once`);
    });
  }

  test("no file anywhere under src calls the raw generateMeetingBrief's underlying askModel-style unbounded cycle from a new call site", () => {
    // generateMeetingBrief itself is the one pre-Stage-3 path allowed to
    // cycle through all 4 candidate models (meeting_prep) — this just
    // confirms nothing NEW reaches for that broader, unbounded pattern.
    const newGroqFiles = [
      "src/app/president/chat-inbox-answer.ts",
      "src/app/president/chat-proposal-builder.ts",
      "src/app/president/chat-communication-draft.ts",
      "src/app/president/chat-cleanup-review.ts",
      "src/app/president/meeting-transcription-actions.ts",
    ];
    for (const file of newGroqFiles) {
      assert.doesNotMatch(read(file), /generateMeetingBrief\(/, `${file} must not use the unbounded meeting-brief call path`);
    }
  });
});

describe("no temp-file or disk-write audio handling anywhere in the Stage 9 path", () => {
  const audioFiles = [
    "src/app/president/meeting-transcription-actions.ts",
    "src/lib/groq.ts",
    "src/components/president/RecorderCleanupPanel.tsx",
  ];

  for (const file of audioFiles) {
    test(`${file} never writes audio bytes to disk`, () => {
      assert.doesNotMatch(read(file), /writeFile|createWriteStream|tmpdir\(|fs\.write/);
    });
  }
});

describe("AI Workspace navigation — no restored tab bar", () => {
  test("AIWorkspace.tsx renders AIChat, not a tab bar component", () => {
    const source = read("src/components/president/AIWorkspace.tsx");
    assert.match(source, /<AIChat/);
    assert.doesNotMatch(stripComments(source), /useState<WorkspaceTab>|TABS\.map/);
  });

  test("no component defines a 'WorkspaceTab' type (the old tab-bar shape) anymore", () => {
    for (const file of componentFiles) {
      assert.doesNotMatch(read(file), /type WorkspaceTab/, `${file} should not reintroduce tab-bar navigation`);
    }
  });
});
