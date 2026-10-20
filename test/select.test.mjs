import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "../src/config.mjs";
import { buildPayload, choose, render } from "../src/select.mjs";

const rows = [
  { id: "1", title: "Northwind menu parity", narrative: "menu gap", created_at: "2026-10-18T00:00:00Z" },
  { id: "2", title: "claude-mem semantic inject", narrative: "settings key", created_at: "2026-10-18T00:00:00Z" },
  { id: "3", title: "Dashboard refresh", narrative: "None", created_at: "2026-10-17T00:00:00Z" },
];
const answers = { r1: { noul: 0.2 }, r2: { noul: 0.9 }, r3: { noul: 0.75 } };

test("payload asks one yes/no question per candidate", () => {
  const p = buildPayload("why does claude-mem inject unrelated records", rows);
  assert.deepEqual(Object.keys(p.questions), ["r1", "r2", "r3"]);
  assert.equal(p.questions.r2.type, "noul");
  assert.equal(p.state.records.r3.summary, undefined, "literal None is dropped");
});

test("top1 injects only the highest record above the threshold", () => {
  const { picked } = choose(rows, answers, normalize({ mode: "top1", minProbability: 0.7 }));
  assert.deepEqual(picked.map((s) => s.row.id), ["2"]);
});

test("all injects every record above the threshold, best first", () => {
  const { picked } = choose(rows, answers, normalize({ mode: "all", minProbability: 0.7 }));
  assert.deepEqual(picked.map((s) => s.row.id), ["2", "3"]);
});

test("nothing passes -> nothing injected (fresh work stays clean)", () => {
  const low = { r1: { noul: 0.1 }, r2: { noul: 0.3 }, r3: { noul: 0.05 } };
  const { picked } = choose(rows, low, normalize({ mode: "top1" }));
  assert.equal(picked.length, 0);
  assert.equal(render(picked, normalize({})), "");
});

test("missing answers count as no", () => {
  const { picked, scored } = choose(rows, { r2: { noul: 0.95 } }, normalize({ mode: "all" }));
  assert.deepEqual(picked.map((s) => s.row.id), ["2"]);
  assert.equal(scored[0].probability, null);
});

test("invalid settings fall back to defaults", () => {
  const c = normalize({ mode: "best", minProbability: 3, candidates: 0, maxInject: 99 });
  assert.equal(c.mode, "top1");
  assert.equal(c.minProbability, 0.7);
  assert.equal(c.candidates, 5);
  assert.equal(c.maxInject, 5);
});

test("index format renders one line per record with id", () => {
  const { picked } = choose(rows, answers, normalize({ mode: "all" }));
  const text = render(picked, normalize({ format: "index" }));
  assert.match(text, /^- #2 claude-mem semantic inject/m);
  assert.match(text, /JEV 0\.90/);
});
