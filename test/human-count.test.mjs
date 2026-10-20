import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSessionPayload,
  classifyPrompt,
  collectSessions,
  extractAgy,
  extractClaude,
  extractCodex,
  formatReport,
  humanCount,
  jevScores,
  keywordScore,
  topicTerms,
} from "../src/human-count.mjs";

const FX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "human-count");
const roots = { claude: join(FX, "claude"), codex: join(FX, "codex"), agy: join(FX, "agy", "history.jsonl") };
const S = "aaaaaaaa-0000-0000-0000-000000000001";
const O = "bbbbbbbb-0000-0000-0000-000000000002";
const TOPIC = "Northwind data-sync / datasync-oracle engine";
const SINCE = "2026-10-18T00:00:00Z";

test("claude: counts typed + queued prompts, skips tool results, meta, sidechain, notifications, injected-only", async () => {
  const s = await extractClaude(join(roots.claude, "-w-northwind", `${S}.jsonl`));
  const texts = s.prompts.map((p) => p.text);
  assert.equal(s.id, S);
  assert.equal(s.title, "Northwind data-sync oracle");
  assert.deepEqual(texts, [
    "Build the northwind datasync oracle engine now",
    "1",
    "[Image #1]",
    "as recommended",
    "queued while it was working",
    "too early for the window",
  ]);
  assert.equal(s.prompts.filter((p) => p.queued).length, 1, "queued prompt delivered twice counts once");
});

test("claude: old transcripts without origin fall back to text rules", async () => {
  const s = await extractClaude(join(roots.claude, "-w-old", `${O}.jsonl`));
  assert.deepEqual(s.prompts.map((p) => p.text), ["check the datasync oracle", "approve"]);
});

test("codex exec sessions have no human prompts; interactive ones skip injected context", async () => {
  const exec = await extractCodex(join(roots.codex, "2026/10/18/rollout-exec.jsonl"));
  assert.equal(exec.entrypoint, "exec");
  assert.equal(exec.prompts.length, 0);
  const live = await extractCodex(join(roots.codex, "2026/10/18/rollout-live.jsonl"));
  assert.deepEqual(live.prompts.map((p) => p.text), ["northwind datasync status?", "ok"]);
});

test("agy history groups by conversation, drops slash commands, buckets rows without an id by workspace+day", () => {
  const groups = extractAgy(roots.agy);
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
  assert.deepEqual(byId["agy-conv-1"].prompts.map((p) => p.text), ["northwind datasync question", "2"]);
  assert.ok(byId["agy:/w/solo:2026-10-18"]);
});

test("collectSessions: window, sdk skip, subagent files ignored", async () => {
  const win = { since: Date.parse(SINCE), until: null };
  const { sessions, stats } = await collectSessions({ runtimes: new Set(["claude", "codex", "agy"]), win, roots });
  const ids = sessions.map((s) => s.id).sort();
  assert.ok(!ids.includes("cccccccc-0000-0000-0000-000000000003"), "sdk-cli session skipped");
  assert.ok(!ids.includes("codex-exec"));
  assert.equal(stats.programmatic, 2);
  assert.equal(sessions.filter((s) => s.id === S).length, 1, "subagent transcript not counted as a session");
  assert.equal(sessions.find((s) => s.id === S).prompts.length, 5, "prompt before --since dropped");
});

test("approval vs instruction", () => {
  for (const t of ["1", "option 2", "B", "as recommended", "approve", "sounds good", "LGTM", "Yes!", "go ahead", "[Image #1] 1"]) {
    assert.equal(classifyPrompt(t), "approval", t);
  }
  for (const t of ["as recommended, then commit and push", "how long is the lead time", "[Image #1]", "logged in", "Build the thing"]) {
    assert.equal(classifyPrompt(t), "instruction", t);
  }
});

test("topic terms squash hyphens and spaces; keyword score weighs cwd higher", () => {
  const terms = topicTerms("Northwind data-sync / Blue Kettle / PixelForge forgerules");
  for (const t of ["northwind", "datasync", "bluekettle", "pixelforge", "forgerules", "forgerule"]) assert.ok(terms.includes(t), t);
  const s = { title: null, cwd: "/w/northwind-x", prompts: [{ text: "the data sync design" }, { text: "other" }] };
  assert.deepEqual(keywordScore(s, terms), { score: 3, hits: ["northwind", "datasync"] });
});

test("jev payload asks one yes/no per session with first 5 prompts", () => {
  const s = { runtime: "claude", cwd: "/w", title: "t", prompts: Array.from({ length: 8 }, (_, i) => ({ text: `p${i}` })) };
  const p = buildSessionPayload("topic", [s, s]);
  assert.deepEqual(Object.keys(p.questions), ["s1", "s2"]);
  assert.equal(p.questions.s1.type, "noul");
  assert.equal(p.state.sessions.s1.first_prompts.length, 5);
});

test("jevScores keeps going when a chunk fails", async () => {
  const ss = Array.from({ length: 3 }, () => ({ runtime: "claude", cwd: "", title: "", prompts: [{ text: "x" }] }));
  let n = 0;
  const call = async () => {
    if (++n === 1) throw new Error("JEV HTTP 500");
    return { s1: { noul: 0.9 } };
  };
  const r = await jevScores({ topic: "t", candidates: ss, key: "k", chunk: 2, call });
  assert.equal(r.errors.length, 1);
  assert.equal(r.scores.size, 1);
});

test("humanCount with JEV: threshold decides, totals add up", async () => {
  const call = async ({ payload }) => {
    const out = {};
    for (const [k, v] of Object.entries(payload.state.sessions)) out[k] = { noul: v.first_prompts.some((p) => /bread/.test(p)) ? 0.1 : 0.9 };
    return out;
  };
  const r = await humanCount({ topic: TOPIC, since: SINCE, roots, key: "k", call, minProbability: 0.7, useJev: true });
  assert.equal(r.jev.used, true);
  const included = r.sessions.filter((s) => s.included).map((s) => s.id).sort();
  assert.deepEqual(included, [O, S, "agy-conv-1", "codex-live"].sort());
  assert.equal(r.totals.relatedSessions, 4);
  assert.equal(r.totals.humanPrompts, 5 + 2 + 2 + 2);
  assert.equal(r.totals.approvalOnly + r.totals.instructions, r.totals.humanPrompts);
  assert.equal(r.totals.queuedPrompts, 1);
  assert.equal(r.sessions.find((s) => s.id === S).jev, 0.9);
});

test("humanCount without a key falls back to the keyword filter and says so", async () => {
  const r = await humanCount({ topic: TOPIC, since: SINCE, roots, key: null, useJev: true });
  assert.equal(r.jev.used, false);
  assert.match(r.jev.reason, /no JEV key/);
  assert.ok(r.sessions.find((s) => s.id === S).included);
  assert.ok(!r.sessions.find((s) => s.id === "dddddddd-0000-0000-0000-000000000004").included, "unrelated session stays out");
  assert.match(formatReport(r), /NOT used: no JEV key/);
});

test("prompt text stays out of the report unless asked", async () => {
  const quiet = await humanCount({ topic: TOPIC, since: SINCE, roots, key: null });
  assert.doesNotMatch(JSON.stringify(quiet), /Build the northwind/);
  const shown = await humanCount({ topic: TOPIC, since: SINCE, roots, key: null, show: true });
  const sample = shown.sessions.find((s) => s.id === S).samples[0];
  assert.ok(sample.length <= 40);
});
