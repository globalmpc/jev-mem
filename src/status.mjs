// One line for the user per turn. Plain words on purpose: the reader should get it at a glance.
// null: nothing worth showing (short prompts, hook turned off).
const SKIP_REASONS = {
  "short-prompt": "message too short",
  disabled: "turned off",
  "no-jev-key": "no JEV key",
  "no-candidates": "no notes yet",
};

export function statusLine(decision) {
  const tag = "[jev-mem]";
  const secs = `${((decision.ms ?? 0) / 1000).toFixed(1)}s`;
  if (decision.error) return `${tag} Memory search failed, so no notes added (${decision.error}).`;
  if (decision.skipped === "short-prompt" || decision.skipped === "disabled") return null;
  if (decision.skipped) return `${tag} Skipped memory: ${SKIP_REASONS[decision.skipped] ?? decision.skipped}.`;
  const found = decision.candidates.length;
  const picked = decision.candidates.filter((c) => decision.injected.includes(c.id));
  if (!found) return `${tag} No related notes found (${secs}).`;
  if (!picked.length) return `${tag} Found ${found} notes. None fit well, so none added (${secs}).`;
  const best = picked.map((c) => `#${c.id}, ${Math.round((c.p ?? 0) * 100)}% match`).join("; ");
  return `${tag} Found ${found} notes. Added the best ${picked.length} (${best}) (${secs}).`;
}
