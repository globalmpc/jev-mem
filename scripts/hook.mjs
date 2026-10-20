#!/usr/bin/env node
// Prompt-time hook for any runtime with an adapter: `hook.mjs --runtime claude`.
// Reads the runtime's hook JSON on stdin and prints context only when JEV judged a record relevant.
import { ADAPTERS } from "../src/adapters/index.mjs";
import { loadConfig } from "../src/config.mjs";
import { logDecision, selectContext } from "../src/run.mjs";
import { statusLine } from "../src/status.mjs";

// Hard ceiling: whatever hangs (stdin, git, network), the prompt goes through without memory.
setTimeout(() => process.exit(0), 35000).unref();

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const i = process.argv.indexOf("--runtime");
  const adapter = ADAPTERS[i >= 0 ? process.argv[i + 1] : "claude"];
  if (adapter) {
    const { prompt, cwd } = adapter.read(JSON.parse((await readStdin()) || "{}"));
    const config = loadConfig();
    const { context, decision } = await selectContext({ prompt, cwd: cwd || process.cwd(), config });
    logDecision({ decision, prompt, config });
    process.stdout.write(adapter.write({ prompt, context, status: statusLine(decision) }));
  }
} catch {
  // Never block or alter the user's prompt.
}
process.exit(0);
