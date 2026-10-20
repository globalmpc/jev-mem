// Who owns the socket listening on a local port, asked of the OS rather than the peer:
// a squatter can claim anything over HTTP, but not another uid in the kernel's socket table.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** uids listening on `port` from /proc/net/tcp{,6} text (Linux). Columns: sl local rem st ... uid. */
export function uidsFromProcNet(text, port) {
  const uids = [];
  for (const line of String(text).split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8 || cols[3] !== "0A") continue; // 0A = LISTEN
    if (Number.parseInt(cols[1].split(":").at(-1), 16) === port) uids.push(Number(cols[7]));
  }
  return uids;
}

/**
 * uids of listeners bound to exactly `host` from `lsof -Fun` output ("u501" per process,
 * "n127.0.0.1:37701" per socket). macOS lsof shows only sockets this user may see, so another
 * account's listener on a different address ([::1], 127.0.0.2, *) would be invisible: only an
 * exact-address match counts. A wildcard bind ("*") never counts: another account's more specific
 * bind on the same port would be invisible yet win the connection.
 */
export function uidsFromLsof(text, host) {
  const want = String(host).replace(/^\[|\]$/g, "");
  const uids = [];
  let uid = null;
  for (const line of String(text).split("\n")) {
    if (/^u\d+$/.test(line)) uid = Number(line.slice(1));
    else if (line.startsWith("n") && uid !== null) {
      const addr = line.slice(1, line.lastIndexOf(":")).replace(/^\[|\]$/g, "");
      if (addr === want) uids.push(uid);
    }
  }
  return uids;
}

/**
 * uids listening on a TCP port: [] when none is visible, null when this platform has no check.
 * Linux lists every account's sockets, so all listeners on the port count, on any address.
 */
export function listenerUids(port, host, platform = process.platform) {
  if (platform === "linux") {
    const read = (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return "";
      }
    };
    return [...uidsFromProcNet(read("/proc/net/tcp"), port), ...uidsFromProcNet(read("/proc/net/tcp6"), port)];
  }
  if (platform === "darwin") {
    try {
      // Absolute path: hook runners may start node without /usr/sbin on PATH, and PATH must not pick the binary.
      const out = execFileSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fun"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      });
      return uidsFromLsof(out, host);
    } catch {
      return []; // lsof exits 1 when it finds nothing visible to us
    }
  }
  return null;
}
