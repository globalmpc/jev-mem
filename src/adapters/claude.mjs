// Claude Code UserPromptSubmit hook. The status line goes to the user as `systemMessage`;
// records go to the model as factual `additionalContext` (imperative text there can trip
// Claude's prompt-injection defenses).
export const claude = {
  // claude-mem prefers CLAUDE_PROJECT_DIR over the hook cwd, so subagent temp dirs never name a project.
  read: (input) => ({
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    cwd: process.env.CLAUDE_PROJECT_DIR?.trim() || input.cwd,
  }),
  write: ({ prompt, context, status }) => {
    if (!prompt) return "{}";
    const out = {
      ...(status ? { systemMessage: status } : {}),
      ...(context ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } } : {}),
    };
    return JSON.stringify(out);
  },
};
