import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionPayload } from "../src/human-count.mjs";
import { redactSecrets } from "../src/redact.mjs";
import { buildPayload } from "../src/select.mjs";

const SECRETS = [
  "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
  "sk-proj-ABCDEFGHIJKLMNOPQRSTUV1234",
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
  "AKIAIOSFODNN7EXAMPLE",
  "xoxb-123456789012-abcdefghijkl",
  "AIzaSyA-abcdefghijklmnopqrstuvwxyz01234",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123_-xyz",
];

test("known token shapes are masked", () => {
  for (const s of SECRETS) {
    const out = redactSecrets(`use ${s} now`);
    assert.doesNotMatch(out, new RegExp(s.slice(4, 16).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), s);
    assert.match(out, /\[redacted\]/);
  }
});

test("key=value secrets, bearer tokens, and private key blocks are masked", () => {
  assert.equal(redactSecrets("password = hunter2hunter2"), "password = [redacted]");
  assert.equal(redactSecrets('API_KEY="abc123def456"'), 'API_KEY="[redacted]"');
  assert.equal(redactSecrets("Authorization: Bearer abcdef1234567890"), "Authorization: Bearer [redacted]");
  assert.equal(redactSecrets("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----"), "[redacted]");
});

test("ordinary text is left alone", () => {
  const s = "Fix the token refresh bug in src/auth.ts; the key point is retry order.";
  assert.equal(redactSecrets(s), s);
});

test("JEV payloads are redacted", () => {
  const p = buildPayload(`deploy with ${SECRETS[0]}`, [{ id: "1", title: "t", narrative: `token: ${SECRETS[2]}`, created_at: "" }]);
  assert.doesNotMatch(JSON.stringify(p), /sk-ant-api03|ghp_abc/);
  const s = buildSessionPayload("topic", [{ runtime: "claude", cwd: "/w", title: "", prompts: [{ text: `key ${SECRETS[4]}` }] }]);
  assert.doesNotMatch(JSON.stringify(s), /AKIAIOSFODNN7EXAMPLE/);
});

test("JSON-quoted keys and URL credentials are masked", () => {
  assert.equal(redactSecrets('{"password": "hunter2hunter2"}'), '{"password": "[redacted]"}');
  assert.equal(redactSecrets('{"apiKey":"abc123def456"}'), '{"apiKey":"[redacted]"}');
  assert.equal(redactSecrets("postgres://admin:s3cretpass@db.example:5432/app"), "postgres://admin:[redacted]@db.example:5432/app");
});

test("code and prose that only mention secrets are left alone", () => {
  for (const s of ["token: string", "apiKey: string;", "password: Buffer", "secret = foo()", "use bearer authentication everywhere"]) {
    assert.equal(redactSecrets(s), s);
  }
});

test("secrets without digits are still masked; quoted values are masked whole", () => {
  assert.equal(redactSecrets("password = hunterhunter"), "password = [redacted]");
  assert.equal(redactSecrets('secret: "my pass, phrase"'), 'secret: "[redacted]"');
  assert.equal(redactSecrets("Authorization: Bearer abcdefghijklmnop"), "Authorization: Bearer [redacted]");
  assert.equal(redactSecrets("token = getToken()"), "token = getToken()");
});

test("exclusions apply only to the whole token", () => {
  assert.equal(redactSecrets("password=true-Secret99"), "password=[redacted]");
  assert.equal(redactSecrets("password=hunter22("), "password=[redacted](");
  assert.equal(redactSecrets("Authorization: Bearer auth-9f8e7d6c5b4a"), "Authorization: Bearer [redacted]");
  assert.equal(redactSecrets("token = getToken()"), "token = getToken()");
  assert.equal(redactSecrets("token = cfg.readToken(env)"), "token = cfg.readToken(env)");
});
