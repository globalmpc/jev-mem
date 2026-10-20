#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_PATH, loadConfig, workerUrl } from "../src/config.mjs";
import { apiKey } from "../src/jev.mjs";
import { formatReport, humanCount } from "../src/human-count.mjs";
import { readMemSettings, writeMemSettings } from "../src/mem-settings.mjs";
import { LOG_PATH, selectContext } from "../src/run.mjs";

// claude-mem keys this plugin replaces: its own prompt-time injection and its session-start list.
const MEM_KEYS = {
  CLAUDE_MEM_SEMANTIC_INJECT: "false",
  CLAUDE_MEM_CONTEXT_OBSERVATIONS: "0",
  CLAUDE_MEM_CONTEXT_SESSION_COUNT: "0",
};

const USAGE = `jev-mem — JEV picks which claude-mem records reach the prompt

  jev-mem try "<prompt>" [--cwd DIR] [--json]   dry run: candidates, JEV scores, injected text
  jev-mem doctor                                check worker, JEV key, claude-mem settings
  jev-mem setup [--apply]                       show (or apply, with backup) claude-mem settings changes
  jev-mem config                                print effective settings
  jev-mem human-count --topic "<text>" [--since ISO] [--until ISO] [--runtime claude|codex|agy|all]
                      [--keywords a,b] [--min-probability 0.7] [--jev] [--show] [--json] [--out FILE]
                                                count prompts a human typed in all sessions related to a topic
                                                (local keyword filter; --jev also sends session summaries to JEV)

Settings: ${CONFIG_PATH}
Decision log: ${LOG_PATH}`;

async function doctor() {
  const config = loadConfig();
  let base = "(invalid)";
  let worker = "unreachable";
  try {
    base = workerUrl(config);
    const r = await fetch(`${base}/api/search?query=health&type=observations&format=json&limit=1`, {
      signal: AbortSignal.timeout(2000),
    });
    worker = r.ok ? "ok" : `HTTP ${r.status}`;
  } catch (err) {
    if (base === "(invalid)") worker = err.message;
  }
  const mem = readMemSettings().values;
  const conflicts = Object.entries(MEM_KEYS).filter(([k, v]) => String(mem[k] ?? "") !== v);
  console.log(`claude-mem worker  ${base}  ${worker}`);
  console.log(`JEV key            ${apiKey() ? "found" : "missing (JEV_API_KEY or ~/.jev-router.env)"}`);
  console.log(`claude-mem config  ${conflicts.length ? `change needed: ${conflicts.map(([k]) => k).join(", ")} (run: jev-mem setup)` : "ok"}`);
  console.log(`mode               ${config.mode}, candidates ${config.candidates}, minProbability ${config.minProbability}`);
}

function setup(apply) {
  const settings = readMemSettings();
  const mem = settings.values;
  const changes = Object.entries(MEM_KEYS).filter(([k, v]) => String(mem[k] ?? "") !== v);
  if (!changes.length) return console.log("claude-mem settings already match.");
  for (const [k, v] of changes) console.log(`${k}: ${mem[k] ?? "(default)"} -> ${v}`);
  if (!apply) return console.log("\nNothing written. Re-run with --apply to write (a backup is kept).");
  if (!existsSync(dirname(settings.path))) {
    throw new Error(`${dirname(settings.path)} not found. Install claude-mem and start it once, then re-run setup.`);
  }
  const { backup } = writeMemSettings(settings, Object.fromEntries(changes));
  if (backup) console.log(`backup: ${backup}`);
  console.log(`written: ${settings.path} (other keys kept). Takes effect in new sessions.`);
}

async function tryPrompt(args) {
  const i = args.indexOf("--cwd");
  const cwd = i >= 0 ? args[i + 1] : process.cwd();
  const json = args.includes("--json");
  const prompt = args.filter((a, j) => !a.startsWith("--") && args[j - 1] !== "--cwd").join(" ");
  const { context, decision } = await selectContext({ prompt, cwd, config: loadConfig() });
  if (json) return console.log(JSON.stringify({ decision, context }, null, 2));
  console.log(`project ${decision.project ?? "(all)"}  ${decision.ms} ms  ${decision.skipped ?? decision.error ?? ""}`);
  for (const c of decision.candidates) {
    const mark = decision.injected.includes(c.id) ? "INJECT" : "      ";
    console.log(`${mark} vec#${c.vectorRank} p=${c.p?.toFixed(2) ?? " -- "}  #${c.id} ${c.title}`);
  }
  console.log(context ? `\n${context}` : "\n(nothing injected)");
}

function flags(args) {
  const out = { _: [] };
  const valued = new Set(["topic", "since", "until", "runtime", "keywords", "min-probability", "out"]);
  for (let i = 0; i < args.length; i++) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(args[i]);
    if (!m) out._.push(args[i]);
    else if (m[2] !== undefined) out[m[1]] = m[2];
    else if (valued.has(m[1])) out[m[1]] = args[++i];
    else out[m[1]] = true;
  }
  return out;
}

async function humanCountCmd(args) {
  const f = flags(args);
  const topic = f.topic ?? f._.join(" ");
  if (!topic) return console.error('human-count needs --topic "<text>"');
  const runtime = f.runtime ?? "all";
  if (!["claude", "codex", "agy", "all"].includes(runtime)) return console.error("--runtime must be claude, codex, agy, or all");
  const config = loadConfig();
  const report = await humanCount({
    topic,
    since: f.since,
    until: f.until,
    runtimes: runtime === "all" ? ["claude", "codex", "agy"] : [runtime],
    extraKeywords: f.keywords ? f.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [],
    minProbability: f["min-probability"] !== undefined ? Number(f["min-probability"]) : config.minProbability,
    key: apiKey(),
    // Opt-in: --jev sends session summaries (redacted) to JEV. --no-jev is still accepted.
    useJev: Boolean(f.jev) && !f["no-jev"],
    show: Boolean(f.show),
  });
  if (f.out) {
    mkdirSync(dirname(f.out), { recursive: true });
    writeFileSync(f.out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    chmodSync(f.out, 0o600); // mode above only applies when the file is new
  }
  if (f.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(formatReport(report));
    if (f.out) console.log(`\nwritten: ${f.out}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "try") await tryPrompt(rest);
  else if (cmd === "doctor") await doctor();
  else if (cmd === "setup") setup(rest.includes("--apply"));
  else if (cmd === "human-count") await humanCountCmd(rest);
  else if (cmd === "config") console.log(JSON.stringify(loadConfig(), null, 2));
  else console.log(USAGE);
} catch (err) {
  console.error(`jev-mem: ${err.message}`);
  process.exitCode = 1;
}
