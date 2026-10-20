// Masks credential-shaped text before anything leaves the machine (JEV requests).
// Best effort: catches common token formats and `name = value` secrets, not every possible secret.
const R = "[redacted]";
const SECRET_NAME = "[A-Za-z0-9_.-]*(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|token|credential)[A-Za-z0-9_.-]*";
const TYPE_WORDS = "string|number|boolean|buffer|bytes|object|unknown|undefined|null|none|any|void|str|int|bool|true|false";

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, R],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, R],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, R],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, R],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  // Bearer tokens; only a few English words that follow "bearer" in prose are left alone.
  [/\b(Bearer\s+)(?!(?:authentication|authorization|tokens?|auth|scheme|header)(?![A-Za-z0-9._~+/=-]))[A-Za-z0-9._~+/=-]{12,}/gi, `$1${R}`],
  // Credentials inside URLs: scheme://user:secret@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, `$1${R}$2`],
  // NAME = "value" / "name": 'value' after a secret-holder name: the whole quoted value.
  [new RegExp(`\\b(${SECRET_NAME}["']?\\s*[:=]\\s*)(["'])[^"'\\n]{6,}\\2`, "gi"), `$1$2${R}$2`],
  // NAME = value unquoted: any 6+ character token, except a whole-token type name (`token: string`)
  // and a complete call expression (`getToken()`, `cfg.read(env)`).
  [
    new RegExp(
      `\\b(${SECRET_NAME}\\s*[:=]\\s*)(?!(?:${TYPE_WORDS})(?![^\\s"',;()]))(?![A-Za-z_$][\\w$.]*\\([^()\\s]*\\))[^\\s"',;()]{6,}(?![^\\s"',;()])`,
      "gi",
    ),
    `$1${R}`,
  ],
];

export function redactSecrets(text) {
  let out = String(text ?? "");
  for (const [re, to] of PATTERNS) out = out.replace(re, to);
  return out;
}
