import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

function fromEnvFile(path) {
  try {
    const line = readFileSync(path, "utf8")
      .split("\n")
      .find((l) => /^\s*(?:export\s+)?(JEV_API_KEY|TYPESAFE_API_KEY)\s*=/.test(l));
    return line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") || null;
  } catch {
    return null;
  }
}

/** Same key sources as jev-router: the environment, then ~/.jev-router.env. */
export function apiKey({ env = process.env } = {}) {
  const direct = (env.JEV_API_KEY?.trim() || env.TYPESAFE_API_KEY?.trim() || "");
  if (direct) return direct;
  return fromEnvFile(join(homedir(), ".jev-router.env"));
}

/** One request; returns the API's `answers` object. Throws on any failure, never guesses. */
export async function evaluate({ payload, key, signal }) {
  const response = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`JEV HTTP ${response.status}`);
  const data = await response.json();
  if (!data || data.answers === null || typeof data.answers !== "object") throw new Error("JEV response has no answers");
  return data.answers;
}
