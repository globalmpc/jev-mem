import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { assertOwnWorker, findCandidates } from "../src/claude-mem.mjs";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});
// A folder outside git: its key is its own name.
const cwd = realpathSync(mkdtempSync(join(tmpdir(), "jev-mem-cm-")));
const row = { id: 1, title: "t", created_at: "2026-10-18" };

function worker(byProject) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const projects = new URL(url).searchParams.get("projects");
    return { ok: true, json: async () => ({ observations: byProject[projects ?? "*"] ?? [] }) };
  };
  return urls;
}
const args = (scope) => ({ baseUrl: "http://127.0.0.1:1", query: "q", cwd, limit: 5, scope, settings: {} });
const key = cwd.split("/").at(-1);

test("scope project: this checkout's keys only, no fallback", async () => {
  const urls = worker({ "*": [row] });
  const r = await findCandidates(args("project"));
  assert.deepEqual(r.rows, []);
  assert.equal(urls.length, 1);
  assert.match(urls[0], new RegExp(`projects=${key}`));
});

test("scope project-then-all: falls back to every project", async () => {
  worker({ "*": [row] });
  const r = await findCandidates(args("project-then-all"));
  assert.equal(r.rows.length, 1);
  assert.equal(r.project, null);
});

test("scope all: one unscoped search", async () => {
  const urls = worker({ "*": [row] });
  await findCandidates(args("all"));
  assert.doesNotMatch(urls[0], /projects=/);
});

test("socket owner: refused unless every listener is this uid", async () => {
  const base = { baseUrl: "http://127.0.0.1:37701", uid: 501 };
  await assertOwnWorker({ ...base, owners: () => [501] });
  await assert.rejects(assertOwnWorker({ ...base, owners: () => [502] }), /not owned by this user/);
  await assert.rejects(assertOwnWorker({ ...base, owners: () => [] }), /not running or not owned/);
  await assert.rejects(assertOwnWorker({ ...base, owners: () => [501, 0] }), /not owned/);
});

test("socket owner check on this OS accepts our own listener and refuses an empty port", async () => {
  if (!["linux", "darwin"].includes(process.platform)) return;
  globalThis.fetch = real;
  const { createServer } = await import("node:http");
  const server = createServer((_, res) => res.end("{}"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  // Hook runners may start node with a PATH that lacks /usr/sbin, where macOS keeps lsof.
  const path = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  try {
    await assertOwnWorker({ baseUrl: `http://127.0.0.1:${port}` });
  } finally {
    process.env.PATH = path;
    server.close();
  }
  await assert.rejects(assertOwnWorker({ baseUrl: `http://127.0.0.1:${port}` }), /not running or not owned/);
});

test("Linux /proc/net/tcp and lsof output parsing", async () => {
  const { uidsFromLsof, uidsFromProcNet } = await import("../src/worker-owner.mjs");
  const proc = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:9325 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1",
    "   1: 0100007F:9325 0100007F:D0A2 01 00000000:00000000 00:00000000 00000000  1001        0 2 1",
    "   2: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 3 1",
  ].join("\n");
  assert.deepEqual(uidsFromProcNet(proc, 0x9325), [1000]);
  const lsof = "p1\nu501\nf12\nn127.0.0.1:37701\np2\nu501\nf3\nn*:37701\n";
  assert.deepEqual(uidsFromLsof(lsof, "127.0.0.1"), [501]);
  assert.deepEqual(uidsFromLsof(lsof, "[::1]"), [], "own socket on another address does not vouch for ::1");
  assert.deepEqual(uidsFromLsof("p1\nu501\nf3\nn[::1]:37701\n", "[::1]"), [501]);
  assert.deepEqual(uidsFromLsof("p1\nu501\nf3\nn*:37701\n", "127.0.0.1"), [], "wildcard bind is not accepted");
  // macOS refuses wildcard binds with an explanation (Linux sees every account's sockets instead).
  if (process.platform === "darwin") {
    await assert.rejects(
      assertOwnWorker({ baseUrl: "http://127.0.0.1:37701", uid: 501, wildcard: true, owners: () => [] }),
      /CLAUDE_MEM_WORKER_HOST=127\.0\.0\.1/,
    );
  }
});

test("remote workers (explicitly allowed) and no-uid platforms skip the socket check", async () => {
  await assertOwnWorker({ baseUrl: "https://mem.example", owners: () => [] });
});

test("pid fallback (Windows): another user's pid is refused", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ pid: 1 }) }); // pid 1 is root's init/launchd
  if (process.platform === "win32" || process.getuid?.() === 0) return; // POSIX non-root only
  await assert.rejects(assertOwnWorker({ baseUrl: "http://127.0.0.1:1", owners: () => null }), /another user/);
});

test("pid fallback: own pid, or no pid, passes", async () => {
  const opts = { baseUrl: "http://127.0.0.1:1", owners: () => null };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ pid: process.pid }) });
  await assertOwnWorker(opts);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  await assertOwnWorker(opts);
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assertOwnWorker(opts);
});
