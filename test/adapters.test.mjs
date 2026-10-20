import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ADAPTERS } from "../src/adapters/index.mjs";
import { statusLine } from "../src/status.mjs";

const IMPERATIVE = /\b(print|call|do not|ignore|must)\b/i;

test("claude/codex: status to the user via systemMessage, records as factual context", () => {
  for (const name of ["claude", "codex"]) {
    const out = JSON.parse(ADAPTERS[name].write({ prompt: "p", context: "## Relevant past work\nfacts", status: "[jev-mem] Found 1." }));
    assert.equal(out.systemMessage, "[jev-mem] Found 1.");
    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.equal(out.hookSpecificOutput.additionalContext, "## Relevant past work\nfacts");
  }
});

test("claude: nothing injected -> no model context at all", () => {
  const out = JSON.parse(ADAPTERS.claude.write({ prompt: "p", context: "", status: "[jev-mem] None fit." }));
  assert.equal(out.hookSpecificOutput, undefined);
  assert.equal(out.systemMessage, "[jev-mem] None fit.");
  assert.equal(ADAPTERS.claude.write({ prompt: "p", context: "", status: null }), "{}");
});

test("claude: CLAUDE_PROJECT_DIR wins over the hook cwd, like claude-mem", () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = "/repo";
  try {
    assert.equal(ADAPTERS.claude.read({ prompt: "p", cwd: "/tmp/sub" }).cwd, "/repo");
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});

test("agy: newest USER_INPUT line is the prompt; tags stripped; other last lines mean mid-turn", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-mem-agy-"));
  const t = join(dir, "transcript.jsonl");
  writeFileSync(t, '{"type":"MODEL_OUTPUT","content":"x"}\n{"type":"USER_INPUT","content":"<USER_REQUEST>fix the login bug</USER_REQUEST>"}\n\n');
  assert.deepEqual(ADAPTERS.agy.read({ transcriptPath: t, workspacePaths: ["/w"] }), { prompt: "fix the login bug", cwd: "/w" });
  writeFileSync(t, '{"type":"USER_INPUT","content":"a"}\n{"type":"TOOL_CALL"}\n');
  assert.equal(ADAPTERS.agy.read({ transcriptPath: t }).prompt, "");
  assert.equal(ADAPTERS.agy.read({ transcriptPath: join(dir, "missing.jsonl") }).prompt, "");
  assert.equal(ADAPTERS.agy.read({}).prompt, "");
});

test("agy: context only when something was injected", () => {
  const out = JSON.parse(ADAPTERS.agy.write({ prompt: "p", context: "facts", status: "[jev-mem] Found 1." }));
  assert.match(out.injectSteps[0].ephemeralMessage, /facts/);
  assert.equal(ADAPTERS.agy.write({ prompt: "p", context: "", status: "x" }), "{}");
});

test("status: silent for short prompts and when turned off", () => {
  assert.equal(statusLine({ skipped: "short-prompt" }), null);
  assert.equal(statusLine({ skipped: "disabled" }), null);
  assert.match(statusLine({ skipped: "no-jev-key" }), /JEV key/);
});

test("injected context has no imperative system instructions", async () => {
  const { render } = await import("../src/select.mjs");
  const { normalize } = await import("../src/config.mjs");
  const out = render([{ row: { id: "1", title: "t", narrative: "n", created_at: "2026-10-18" }, probability: 0.9 }], normalize({}));
  assert.doesNotMatch(out.replace(/\n### #1[^\n]*\nn/, ""), IMPERATIVE);
});
