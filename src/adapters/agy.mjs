import { readFileSync } from "node:fs";

// Antigravity CLI PreInvocation hook (~/.gemini/config/hooks.json). Experimental: the transcript
// format is not documented. The hook fires before every model call and does not carry the prompt,
// so read the newest line of the transcript and act only when it is the user's input (the turn's
// first call). Anything unexpected means "no prompt", which injects nothing.
function lastUserInput(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, "utf8").split("\n").filter((l) => l.trim());
    const last = JSON.parse(lines.at(-1) ?? "{}");
    if (last.type !== "USER_INPUT") return "";
    return String(last.content ?? "").replace(/<\/?USER_REQUEST>/g, "").trim();
  } catch {
    return "";
  }
}

export const agy = {
  read: (input) => ({
    prompt: input.transcriptPath ? lastUserInput(input.transcriptPath) : "",
    cwd: input.workspacePaths?.[0],
  }),
  // agy has no user-facing message field here, so only injected records are sent, with the status as a fact.
  write: ({ prompt, context, status }) =>
    prompt && context ? JSON.stringify({ injectSteps: [{ ephemeralMessage: status ? `${status}\n\n${context}` : context }] }) : "{}",
};
