import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertOwnWorker, findCandidates } from "./claude-mem.mjs";
import { CONFIG_DIR, workerBindsAllInterfaces, workerUrl } from "./config.mjs";
import { apiKey, evaluate } from "./jev.mjs";
import { readMemSettings } from "./mem-settings.mjs";
import { buildPayload, choose, render } from "./select.mjs";

export const LOG_PATH = join(CONFIG_DIR, "decisions.jsonl");
// The log rolls over to decisions.jsonl.1 at this size, so it never grows without bound.
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function memSettingsOrEmpty() {
  try {
    return readMemSettings().values;
  } catch {
    return {};
  }
}

/**
 * Vector candidates from claude-mem, judged by JEV, rendered for injection.
 * Every failure ends in "inject nothing": a wrong record costs more than a missing one.
 */
export async function selectContext({ prompt, cwd, config }) {
  const started = Date.now();
  const decision = { mode: config.mode, minProbability: config.minProbability, candidates: [], injected: [] };
  const finish = (context, extra = {}) => ({ context, decision: { ...decision, ...extra, ms: Date.now() - started } });

  if (!config.enabled) return finish("", { skipped: "disabled" });
  if (!prompt || prompt.trim().length < config.minPromptChars) return finish("", { skipped: "short-prompt" });

  const key = apiKey();
  if (!key) return finish("", { skipped: "no-jev-key" });

  const signal = AbortSignal.timeout(config.timeoutMs);
  try {
    const baseUrl = workerUrl(config);
    await assertOwnWorker({ baseUrl, signal, wildcard: workerBindsAllInterfaces(config) });
    const { rows, project } = await findCandidates({
      baseUrl,
      query: prompt.slice(0, 1000),
      cwd,
      limit: config.candidates,
      scope: config.scope,
      settings: memSettingsOrEmpty(),
      signal,
    });
    decision.project = project;
    if (!rows.length) return finish("", { skipped: "no-candidates" });

    const answers = await evaluate({ payload: buildPayload(prompt, rows), key, signal });
    const { scored, picked } = choose(rows, answers, config);
    decision.candidates = scored.map((s) => ({ id: s.row.id, title: s.row.title, vectorRank: s.vectorRank, p: s.probability }));
    decision.injected = picked.map((s) => s.row.id);
    return finish(render(picked, config));
  } catch (err) {
    return finish("", { error: err.name === "TimeoutError" ? "timeout" : err.message });
  }
}

export function logDecision({ decision, prompt, config }) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    chmodSync(CONFIG_DIR, 0o700); // mode above only applies when the directory is new
    const entry = {
      ts: new Date().toISOString(),
      promptChars: prompt?.length ?? 0,
      promptSha: createHash("sha256").update(prompt ?? "").digest("hex").slice(0, 12),
      ...(config.logPrompt ? { prompt } : {}),
      ...decision,
    };
    try {
      if (statSync(LOG_PATH).size > LOG_MAX_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
    } catch {
      // No log yet.
    }
    appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    chmodSync(LOG_PATH, 0o600);
  } catch {
    // Logging never blocks the prompt.
  }
}
