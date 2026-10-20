// Project keys the way claude-mem 14.x names them (src/utils/project-name.ts, worktree.ts,
// project-environments.ts, project-filter.ts), so a search finds what claude-mem stored.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const UNKNOWN = "unknown-project";
const MARKERS = [".claude-mem-project", ".claude-mem.json"];

const realOrSelf = (dir) => {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
};

function expandHome(p, home = homedir()) {
  if (p === "~") return home;
  if (p.startsWith("~/") || (process.platform === "win32" && p.startsWith("~\\"))) return join(home, p.slice(2));
  return p;
}

function git(args, cwd) {
  try {
    return (
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000, windowsHide: true }).trim() ||
      null
    );
  } catch {
    return null; // not a repository, or no git
  }
}

/** Nearest ancestor with a claude-mem marker file; never at or above home, tmp, or ~/.claude. */
function markerRoot(dir) {
  const stops = [homedir(), tmpdir(), join(homedir(), ".claude")].flatMap((d) => [resolve(d), realOrSelf(resolve(d))]);
  let current = resolve(dir);
  for (let depth = 0; depth < 64; depth++) {
    if (stops.includes(current)) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    if (MARKERS.some((m) => existsSync(join(current, m)))) return current;
    current = parent;
  }
  return null;
}

function nameOf(source, cwd) {
  const name = basename(source);
  if (name) return name;
  const drive = /^([A-Z]):\\/i.exec(cwd);
  return process.platform === "win32" && drive ? `drive-${drive[1].toUpperCase()}` : UNKNOWN;
}

/** A `.git` file pointing into `<parent>/.git/worktrees/x` or `<parent>/.git/modules/x`. */
function detectCheckout(dir) {
  const gitPath = join(dir, ".git");
  try {
    if (!statSync(gitPath).isFile()) return null;
    const m = /^gitdir:\s*(.+)$/.exec(readFileSync(gitPath, "utf8").trim());
    if (!m) return null;
    const gitdir = resolve(dirname(gitPath), m[1]);
    const wt = /^(.+)[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/.exec(gitdir);
    if (wt) return { kind: "worktree", parentPath: wt[1], parent: basename(wt[1]) };
    const sm = /^(.+)[/\\]\.git[/\\]modules[/\\].+$/.exec(gitdir);
    if (sm) return { kind: "submodule", parentPath: sm[1], parent: basename(sm[1]) };
  } catch {
    // no .git file
  }
  return null;
}

/** `org/repo` from an origin URL; null for local remotes. */
export function slugFromRemote(url) {
  const t = String(url ?? "").trim();
  if (!t || /^file:/i.test(t) || /^[/.~]/.test(t) || t.startsWith("\\\\") || /^[a-z]:[\\/]/i.test(t)) return null;
  const cleaned = t.replace(/\/+$/, "").replace(/\.git$/i, "");
  const urlForm = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(cleaned);
  const scpForm = urlForm ? null : /^(?:[^/@\s]+@)?[^:/\s]+:(?!\/\/)(.+)$/.exec(cleaned);
  const segments = (urlForm?.[1] ?? scpForm?.[1] ?? "").split("/").filter((s) => s && s !== "_git");
  return segments.length ? segments.slice(-2).join("/") : null;
}

function globToRegex(pattern) {
  const expanded = expandHome(pattern.replace(/\\/g, "/")).replace(/\\/g, "/");
  const body = expanded
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${body}$`);
}

function matchesAnyGlob(path, patterns) {
  const norm = path.replace(/\\/g, "/");
  const base = basename(norm);
  return patterns.some((raw) => {
    const p = raw.trim();
    if (!p) return false;
    try {
      if (globToRegex(p).test(norm) || globToRegex(p).test(base)) return true;
      return p.replace(/\\/g, "/").endsWith("/**") && globToRegex(p.slice(0, -3)).test(norm.replace(/\/+$/, ""));
    } catch {
      return false;
    }
  });
}

/** CLAUDE_MEM_PROJECT_ENVIRONMENTS: [{ name, patterns: [glob] }], as JSON text or an array. */
function environmentFor(dir, raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = value.trim() ? JSON.parse(value) : [];
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const candidates = [...new Set([dir, realOrSelf(dir)])].flatMap((c) => [c, `${c.replace(/[\\/]+$/, "")}/`]);
  for (const e of value) {
    const name = typeof e?.name === "string" ? e.name.trim() : "";
    const patterns = Array.isArray(e?.patterns) ? e.patterns.filter((p) => typeof p === "string") : [];
    if (name && patterns.length && candidates.some((c) => matchesAnyGlob(c, patterns))) return name;
  }
  return null;
}

function pathContext(cwd, dir, repoRoot) {
  const marker = repoRoot ? null : markerRoot(dir);
  const name = nameOf(repoRoot ?? marker ?? dir, cwd);
  const checkout = detectCheckout(repoRoot ?? dir);
  if (checkout) {
    const { parent } = checkout;
    if (checkout.kind === "submodule") {
      const rel = relative(checkout.parentPath, repoRoot ?? dir);
      const leaf = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : name;
      return { primary: `${parent}/${leaf}`, keys: [parent, ...(name !== parent ? [name] : [])] };
    }
    const primary = name === parent ? parent : `${parent}/${name}`;
    return { primary, keys: primary === parent ? [`${parent}/${name}`] : [parent] };
  }
  if (marker && resolve(marker) !== resolve(dir)) {
    const legacy = nameOf(dir, cwd);
    if (legacy !== name && legacy !== UNKNOWN) return { primary: name, keys: [legacy] };
  }
  return { primary: name, keys: [] };
}

/**
 * Every key claude-mem may have stored this checkout's records under, primary last.
 * `settings` holds claude-mem's CLAUDE_MEM_PROJECT_NAME_SOURCE / CLAUDE_MEM_PROJECT_ENVIRONMENTS
 * (environment variables win, as in claude-mem).
 */
export function projectKeys(cwd, { env = process.env, settings = {} } = {}) {
  if (!cwd || !String(cwd).trim()) return [];
  const dir = resolve(expandHome(String(cwd)));
  const repoRoot = git(["rev-parse", "--show-toplevel"], dir);
  let { primary, keys } = pathContext(String(cwd), dir, repoRoot);
  const source = String(env.CLAUDE_MEM_PROJECT_NAME_SOURCE ?? settings.CLAUDE_MEM_PROJECT_NAME_SOURCE ?? "path").trim().toLowerCase();
  const slug = source === "git-remote" && repoRoot ? slugFromRemote(git(["remote", "get-url", "origin"], repoRoot)) : null;
  if (slug) [primary, keys] = [slug, [...keys, primary]];
  const environment = environmentFor(dir, env.CLAUDE_MEM_PROJECT_ENVIRONMENTS ?? settings.CLAUDE_MEM_PROJECT_ENVIRONMENTS);
  if (environment) [primary, keys] = [environment, [...keys, primary]];
  return [...new Set([...keys.filter((k) => k !== primary), primary])];
}
