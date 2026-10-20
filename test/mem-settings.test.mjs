import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { memDir, readMemSettings, writeMemSettings } from "../src/mem-settings.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "jev-mem-ms-"));

test("data dir follows CLAUDE_MEM_DATA_DIR like claude-mem", () => {
  assert.equal(memDir({ CLAUDE_MEM_DATA_DIR: "/data/cm" }), "/data/cm");
  assert.match(memDir({}), /\.claude-mem$/);
});

test("flat settings: read and write at the root", () => {
  const d = dir();
  writeFileSync(join(d, "settings.json"), '﻿{"CLAUDE_MEM_WORKER_PORT":"1234","OTHER":1}');
  const s = readMemSettings({ CLAUDE_MEM_DATA_DIR: d });
  assert.equal(s.values.CLAUDE_MEM_WORKER_PORT, "1234");
  writeMemSettings(s, { CLAUDE_MEM_SEMANTIC_INJECT: "false" });
  assert.deepEqual(JSON.parse(readFileSync(s.path, "utf8")), { CLAUDE_MEM_WORKER_PORT: "1234", OTHER: 1, CLAUDE_MEM_SEMANTIC_INJECT: "false" });
});

test("nested env settings: claude-mem reads env, so read and write there", () => {
  const d = dir();
  writeFileSync(join(d, "settings.json"), JSON.stringify({ CLAUDE_MEM_WORKER_PORT: "9", env: { CLAUDE_MEM_WORKER_PORT: "4321" } }));
  const s = readMemSettings({ CLAUDE_MEM_DATA_DIR: d });
  assert.equal(s.values.CLAUDE_MEM_WORKER_PORT, "4321");
  writeMemSettings(s, { CLAUDE_MEM_SEMANTIC_INJECT: "false" });
  const out = JSON.parse(readFileSync(s.path, "utf8"));
  assert.equal(out.env.CLAUDE_MEM_SEMANTIC_INJECT, "false");
  assert.equal(out.CLAUDE_MEM_SEMANTIC_INJECT, undefined);
});
