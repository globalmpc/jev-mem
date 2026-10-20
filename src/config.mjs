import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readMemSettings } from "./mem-settings.mjs";

export const CONFIG_DIR = join(homedir(), ".jev-mem");
export const CONFIG_PATH = join(CONFIG_DIR, "settings.json");

export const DEFAULTS = Object.freeze({
  enabled: true,
  // "top1": inject only the best record. "all": inject every record that passes the threshold.
  mode: "top1",
  // Vector candidates pulled from claude-mem for JEV to judge.
  candidates: 5,
  // Upper bound for mode "all".
  maxInject: 5,
  // JEV yes-probability a record needs before it is injected. Nothing passes -> nothing injected.
  minProbability: 0.7,
  // "narrative": full record text. "index": one line per record plus its id.
  format: "narrative",
  narrativeChars: 1200,
  // "project": only the current project's records (claude-mem's keys for this checkout).
  // "project-then-all": every project when the current one has no records. "all": every project.
  scope: "project",
  minPromptChars: 20,
  timeoutMs: 6000,
  workerUrl: null,
  // Prompts go to the worker over plain HTTP, so only a loopback address is accepted unless this is true.
  allowRemoteWorker: false,
  logPrompt: false,
});

const ENV = {
  JEV_MEM_ENABLED: ["enabled", "bool"],
  JEV_MEM_MODE: ["mode", "string"],
  JEV_MEM_CANDIDATES: ["candidates", "int"],
  JEV_MEM_MAX_INJECT: ["maxInject", "int"],
  JEV_MEM_MIN_PROBABILITY: ["minProbability", "float"],
  JEV_MEM_FORMAT: ["format", "string"],
  JEV_MEM_SCOPE: ["scope", "string"],
  JEV_MEM_TIMEOUT_MS: ["timeoutMs", "int"],
  JEV_MEM_WORKER_URL: ["workerUrl", "string"],
  JEV_MEM_ALLOW_REMOTE_WORKER: ["allowRemoteWorker", "bool"],
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function cast(value, kind) {
  if (kind === "bool") return ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());
  if (kind === "int") return Number.parseInt(value, 10);
  if (kind === "float") return Number.parseFloat(value);
  return value;
}

/** Settings file, then environment overrides, then validation back to defaults. */
export function loadConfig({ env = process.env, path = CONFIG_PATH } = {}) {
  const config = { ...DEFAULTS, ...readJson(path) };
  for (const [name, [key, kind]] of Object.entries(ENV)) {
    if (env[name] !== undefined && env[name] !== "") config[key] = cast(env[name], kind);
  }
  return normalize(config);
}

export function normalize(config) {
  const out = { ...DEFAULTS, ...config };
  const between = (v, lo, hi, fallback) => (Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);
  if (!["top1", "all"].includes(out.mode)) out.mode = DEFAULTS.mode;
  if (!["narrative", "index"].includes(out.format)) out.format = DEFAULTS.format;
  if (!["project", "project-then-all", "all"].includes(out.scope)) out.scope = DEFAULTS.scope;
  out.candidates = between(out.candidates, 1, 20, DEFAULTS.candidates);
  out.maxInject = between(out.maxInject, 1, out.candidates, Math.min(DEFAULTS.maxInject, out.candidates));
  out.minProbability = between(out.minProbability, 0, 1, DEFAULTS.minProbability);
  out.narrativeChars = between(out.narrativeChars, 100, 10000, DEFAULTS.narrativeChars);
  out.minPromptChars = between(out.minPromptChars, 0, 1000, DEFAULTS.minPromptChars);
  out.timeoutMs = between(out.timeoutMs, 500, 30000, DEFAULTS.timeoutMs);
  out.enabled = ![false, 0, "false", "0", "no", "off"].includes(typeof out.enabled === "string" ? out.enabled.trim().toLowerCase() : out.enabled);
  out.logPrompt = out.logPrompt === true;
  out.allowRemoteWorker = out.allowRemoteWorker === true;
  return out;
}

const LOOPBACK = new Set(["localhost", "[::1]"]);
const isLoopback = (hostname) => LOOPBACK.has(hostname) || /^127(\.\d{1,3}){3}$/.test(hostname);

/** Rejects anything but http(s), and any non-loopback host unless allowRemoteWorker is set. */
function checkWorkerUrl(raw, config) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`worker URL is not valid: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`worker URL must be http or https: ${raw}`);
  if (!config.allowRemoteWorker && !isLoopback(url.hostname)) {
    throw new Error(`worker URL must be a loopback address (set allowRemoteWorker to override): ${raw}`);
  }
  // Dial one literal address: "localhost" may resolve to ::1 or 127.0.0.1, and the ownership check
  // must look at the same address the request goes to.
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
    return url.href.replace(/\/$/, "");
  }
  return raw.replace(/\/$/, "");
}

// claude-mem may bind every interface (CLAUDE_MEM_WORKER_HOST=0.0.0.0 or ::); it is reached on the
// loopback address of the same family.
const WILDCARD = { "0.0.0.0": "127.0.0.1", "::": "[::1]", "[::]": "[::1]" };

function memWorker(env) {
  let mem = {};
  try {
    mem = readMemSettings(env).values;
  } catch {
    // Unreadable claude-mem settings: fall back to its defaults, as claude-mem itself would.
  }
  return {
    host: env.CLAUDE_MEM_WORKER_HOST || mem.CLAUDE_MEM_WORKER_HOST || "127.0.0.1",
    port: env.CLAUDE_MEM_WORKER_PORT || mem.CLAUDE_MEM_WORKER_PORT || String(37700 + ((process.getuid?.() ?? 77) % 100)),
  };
}

/** True when claude-mem binds every interface, so its listener shows as "*" rather than an address. */
export function workerBindsAllInterfaces(config, { env = process.env } = {}) {
  return !config.workerUrl && memWorker(env).host in WILDCARD;
}

/** claude-mem's worker address: its own settings, else its default port (37700 + uid % 100). */
export function workerUrl(config, { env = process.env } = {}) {
  if (config.workerUrl) return checkWorkerUrl(config.workerUrl, config);
  const { host: bind, port } = memWorker(env);
  const host = WILDCARD[bind] ?? bind;
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return checkWorkerUrl(`http://${bracketed}:${port}`, config);
}
