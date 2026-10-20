import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectKeys, slugFromRemote } from "../src/project.mjs";

// realpath: macOS tmpdir is a symlink, and git reports the resolved path.
const base = realpathSync(mkdtempSync(join(tmpdir(), "jev-mem-proj-")));
const sh = (args, cwd) => execFileSync("git", args, { cwd, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
function repo(name) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  sh(["init", "-q", "-b", "main"], dir);
  writeFileSync(join(dir, "f"), "x");
  sh(["add", "f"], dir);
  sh(["commit", "-q", "-m", "init"], dir);
  return dir;
}
const env = {};

test("plain repo: git root name, also from a subfolder", () => {
  const dir = repo("app");
  mkdirSync(join(dir, "src"));
  assert.deepEqual(projectKeys(join(dir, "src"), { env }), ["app"]);
});

test("worktree: parent/worktree, parent readable", () => {
  const dir = repo("shop");
  sh(["worktree", "add", "-q", join(base, "shop-feature"), "-b", "feature"], dir);
  assert.deepEqual(projectKeys(join(base, "shop-feature"), { env }), ["shop", "shop/shop-feature"]);
});

test("worktree named like its repo collapses to the repo", () => {
  const dir = repo("same");
  mkdirSync(join(base, "wt"));
  sh(["worktree", "add", "-q", join(base, "wt", "same"), "-b", "f2"], dir);
  assert.deepEqual(projectKeys(join(base, "wt", "same"), { env }), ["same/same", "same"]);
});

test("submodule: parent/relative path", () => {
  const lib = repo("libsrc");
  const sup = repo("super");
  sh(["-c", "protocol.file.allow=always", "submodule", "add", "-q", lib, "vendor/lib"], sup);
  assert.deepEqual(projectKeys(join(sup, "vendor", "lib"), { env }), ["super", "lib", "super/vendor/lib"]);
});

test("marker file outside git names the project, cwd name stays readable", () => {
  const root = join(base, "plain", "notes");
  mkdirSync(join(root, "deep"), { recursive: true });
  writeFileSync(join(root, ".claude-mem-project"), "");
  assert.deepEqual(projectKeys(join(root, "deep"), { env }), ["deep", "notes"]);
});

test("git-remote mode uses the origin slug, path key stays readable", () => {
  const dir = repo("remote-app");
  sh(["remote", "add", "origin", "git@github.com:acme/remote-app.git"], dir);
  assert.deepEqual(projectKeys(dir, { env: { CLAUDE_MEM_PROJECT_NAME_SOURCE: "git-remote" } }), ["remote-app", "acme/remote-app"]);
  assert.deepEqual(projectKeys(dir, { env, settings: { CLAUDE_MEM_PROJECT_NAME_SOURCE: "git-remote" } }), ["remote-app", "acme/remote-app"]);
});

test("environment patterns win over derived names", () => {
  const dir = repo("client-a");
  const environments = JSON.stringify([{ name: "client", patterns: [`${base}/client-*`] }]);
  assert.deepEqual(projectKeys(dir, { env: { CLAUDE_MEM_PROJECT_ENVIRONMENTS: environments } }), ["client-a", "client"]);
});

test("origin URL slugs", () => {
  assert.equal(slugFromRemote("https://github.com/acme/app.git/"), "acme/app");
  assert.equal(slugFromRemote("ssh://git@host:22/acme/app"), "acme/app");
  assert.equal(slugFromRemote("https://dev.azure.com/o/p/_git/repo"), "p/repo");
  assert.equal(slugFromRemote("/srv/git/app.git"), null);
});
