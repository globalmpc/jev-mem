import { agy } from "./agy.mjs";
import { claude } from "./claude.mjs";
import { codex } from "./codex.mjs";

// One adapter per runtime: parse its hook stdin, format its hook stdout.
export const ADAPTERS = { claude, codex, agy };
