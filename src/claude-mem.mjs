import { projectKeys } from "./project.mjs";
import { listenerUids } from "./worker-owner.mjs";

const SAFE_ID = /^[\w-]{1,64}$/;
const oneLine = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Worker rows reach the model's context, so ids must be plain tokens and titles a single short line. */
function sanitize(row) {
  const id = String(row?.id ?? "");
  return SAFE_ID.test(id) ? { ...row, id, title: oneLine(row.title, 200) } : null;
}

/** Vector search through claude-mem's local worker. Returns observation rows, best match first. */
export async function searchObservations({ baseUrl, query, projects, limit, signal }) {
  const params = new URLSearchParams({ query, type: "observations", format: "json", limit: String(limit) });
  if (projects?.length) params.set("projects", projects.join(","));
  const response = await fetch(`${baseUrl}/api/search?${params}`, { redirect: "error", signal });
  if (!response.ok) throw new Error(`claude-mem worker HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.observations)) return [];
  return data.observations.map(sanitize).filter(Boolean).slice(0, limit);
}

/**
 * "project": only this checkout's keys. "project-then-all": every project when this one has none.
 * "all": every project. A cwd that names no project searches nothing unless scope is "all".
 */
export async function findCandidates({ baseUrl, query, cwd, limit, scope, settings, signal }) {
  if (scope !== "all") {
    const projects = projectKeys(cwd, { settings });
    if (projects.length) {
      const rows = await searchObservations({ baseUrl, query, projects, limit, signal });
      if (rows.length || scope === "project") return { rows, project: projects.at(-1) };
    } else if (scope === "project") {
      return { rows: [], project: null };
    }
  }
  return { rows: await searchObservations({ baseUrl, query, limit, signal }), project: null };
}

/**
 * Another account's worker on our port (two uids can share 37700 + uid % 100, or a process can
 * squat the port while ours is down) would receive our prompts and return its own records.
 * Linux and macOS: the kernel's socket table must show the listener as ours, else refuse.
 * Elsewhere (Windows): claude-mem's /api/health pid must be a process we may signal.
 */
export async function assertOwnWorker({ baseUrl, signal, wildcard = false, owners = listenerUids, uid = process.getuid?.() }) {
  const url = new URL(baseUrl);
  if (!isLoopbackHost(url.hostname)) return; // remote worker: explicitly allowed, nothing local to check
  if (uid === undefined) return pidCheck({ baseUrl, signal });
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const uids = owners(port, url.hostname);
  if (uids === null) return pidCheck({ baseUrl, signal });
  if (!uids.length && wildcard && process.platform === "darwin") {
    throw new Error(
      "claude-mem binds every interface (CLAUDE_MEM_WORKER_HOST=0.0.0.0), so its owner cannot be verified on macOS; set CLAUDE_MEM_WORKER_HOST=127.0.0.1",
    );
  }
  if (!uids.length || uids.some((u) => u !== uid)) {
    throw new Error(`claude-mem worker on port ${port} is not running or not owned by this user`);
  }
}

const isLoopbackHost = (h) => h === "localhost" || h === "[::1]" || /^127(\.\d{1,3}){3}$/.test(h);

async function pidCheck({ baseUrl, signal }) {
  let pid;
  try {
    const response = await fetch(`${baseUrl}/api/health`, { redirect: "error", signal });
    pid = (await response.json())?.pid;
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw err;
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err.code === "EPERM") throw new Error("claude-mem worker on this port belongs to another user");
  }
}
