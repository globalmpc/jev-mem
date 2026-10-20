import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** claude-mem's data folder: CLAUDE_MEM_DATA_DIR, else ~/.claude-mem (same rule as claude-mem). */
export function memDir(env = process.env) {
  return env.CLAUDE_MEM_DATA_DIR || join(homedir(), ".claude-mem");
}

// claude-mem accepts a flat file, or one whose CLAUDE_MEM_* keys live under "env" (then root keys are ignored).
const isNested = (doc) =>
  doc.env !== null && typeof doc.env === "object" && Object.keys(doc.env).some((k) => k.startsWith("CLAUDE_MEM_"));

/** { path, doc, values }: `values` is the key/value block claude-mem actually reads. Throws on unreadable JSON. */
export function readMemSettings(env = process.env) {
  const path = join(memDir(env), "settings.json");
  if (!existsSync(path)) return { path, doc: {}, values: {} };
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`cannot read ${path}: ${err.message}`);
  }
  if (doc === null || typeof doc !== "object") throw new Error(`cannot read ${path}: not a JSON object`);
  return { path, doc, values: isNested(doc) ? doc.env : doc };
}

/** Merges `changes` into the block claude-mem reads. Keeps a 0600 backup and writes via temp file + rename. */
export function writeMemSettings({ path, doc }, changes) {
  let backup = null;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
    chmodSync(backup, 0o600); // claude-mem settings can hold provider keys
  }
  const next = isNested(doc) ? { ...doc, env: { ...doc.env, ...changes } } : { ...doc, ...changes };
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return { backup };
}
