import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "jev-mem.mjs");
// The caller's own claude-mem / jev-mem settings (e.g. CLAUDE_MEM_DATA_DIR) must not reach the CLI under test.
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_MEM_|JEV_MEM_)/.test(k)));
const run = (args, home) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...baseEnv, HOME: home } });

test("setup --apply without claude-mem installed explains instead of crashing", () => {
  const r = run(["setup", "--apply"], mkdtempSync(join(tmpdir(), "jev-mem-cli-")));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /claude-mem/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
});

test("unreadable claude-mem settings give a one-line error", () => {
  const home = mkdtempSync(join(tmpdir(), "jev-mem-cli-"));
  mkdirSync(join(home, ".claude-mem"));
  writeFileSync(join(home, ".claude-mem", "settings.json"), "{bad");
  const r = run(["setup"], home);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /settings\.json/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
});

test("bad --since gives a one-line error", () => {
  const r = run(["human-count", "--topic", "x", "--since", "yesterday", "--no-jev"], mkdtempSync(join(tmpdir(), "jev-mem-cli-")));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--since: cannot parse/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
});

test("human-count stays local unless --jev is passed", () => {
  const home = mkdtempSync(join(tmpdir(), "jev-mem-cli-"));
  const r = spawnSync(process.execPath, [BIN, "human-count", "--topic", "x"], { encoding: "utf8", env: { ...baseEnv, HOME: home, JEV_API_KEY: "k" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /NOT used: off/);
});

test("--out tightens an existing file to 0600", async () => {
  if (process.platform === "win32") return;
  const { statSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "jev-mem-cli-"));
  const out = join(home, "report.json");
  writeFileSync(out, "old", { mode: 0o644 });
  const r = run(["human-count", "--topic", "x", "--out", out], home);
  assert.equal(r.status, 0);
  assert.equal(statSync(out).mode & 0o777, 0o600);
});
