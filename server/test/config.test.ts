import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

const noWarn = () => {};

test("defaults", () => {
  assert.deepEqual(loadConfig({}, noWarn, "/h"), { keys: {}, rejectedKeys: [], keyFixes: {}, timeoutMs: 120000, firstByteMs: 30000, deadlineMs: 300000, maxPromptChars: 100000, dataDir: "/h/.free-to-review" });
});

test("reads both keys", () => {
  assert.deepEqual(loadConfig({ NVIDIA_API_KEY: "n", OPENROUTER_API_KEY: "o" }, noWarn, "/h").keys, { nvidia: "n", openrouter: "o" });
});

test("blank and unsubstituted keys are unset", () => {
  assert.deepEqual(loadConfig({ NVIDIA_API_KEY: "  ", OPENROUTER_API_KEY: "${user_config.openrouter_api_key}" }, noWarn, "/h").keys, {});
});

test("empty strings from plugin substitution mean defaults, no warning", () => {
  const warns: string[] = [];
  const c = loadConfig({ NVIDIA_API_KEY: "", OPENROUTER_API_KEY: "", F2R_FIRST_BYTE_MS: "", F2R_DATA_DIR: "" }, m => warns.push(m), "/h");
  assert.deepEqual(c.keys, {});
  assert.equal(c.firstByteMs, 30000);
  assert.equal(c.dataDir, "/h/.free-to-review");
  assert.equal(warns.length, 0);
});

test("parses values", () => {
  const c = loadConfig({ F2R_TIMEOUT_MS: "5000", F2R_MAX_PROMPT_CHARS: "10" }, noWarn, "/h");
  assert.equal(c.timeoutMs, 5000);
  assert.equal(c.maxPromptChars, 10);
});

test("data dir uses F2R_DATA_DIR unless unsubstituted", () => {
  assert.equal(loadConfig({ F2R_DATA_DIR: "/d" }, noWarn, "/h").dataDir, "/d");
  assert.equal(loadConfig({ F2R_DATA_DIR: "${CLAUDE_PLUGIN_DATA}" }, noWarn, "/h").dataDir, "/h/.free-to-review");
});

test("out of range or non-numeric falls back with a warning", () => {
  const warns: string[] = [];
  const c = loadConfig({ F2R_FIRST_BYTE_MS: "abc", F2R_TIMEOUT_MS: "999" }, m => warns.push(m), "/h");
  assert.equal(c.firstByteMs, 30000);
  assert.equal(c.timeoutMs, 120000);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /F2R_TIMEOUT_MS/);
});

test("non-integer values fall back with a warning", () => {
  const warns: string[] = [];
  const c = loadConfig({ F2R_TIMEOUT_MS: "1500.5", F2R_MAX_PROMPT_CHARS: "0" }, m => warns.push(m), "/h");
  assert.equal(c.timeoutMs, 120000);
  assert.equal(c.maxPromptChars, 100000);
  assert.equal(warns.length, 2);
});

test("first-byte default and override", () => {
  assert.equal(loadConfig({ F2R_FIRST_BYTE_MS: "45000" }, noWarn, "/h").firstByteMs, 45000);
  const warns: string[] = [];
  assert.equal(loadConfig({ F2R_FIRST_BYTE_MS: "500" }, m => warns.push(m), "/h").firstByteMs, 30000);
  assert.deepEqual(warns, ['F2R_FIRST_BYTE_MS="500" is not an integer >= 1000; using 30000']);
});

test("rejects a key with an unknown non-ASCII character", () => {
  const warns: string[] = [];
  const c = loadConfig({ NVIDIA_API_KEY: "nvapi-\u00e9", OPENROUTER_API_KEY: "sk-or-\u00e9" }, m => warns.push(m), "/h");
  assert.deepEqual(c.keys, {});
  assert.deepEqual(c.rejectedKeys, ["nvidia", "openrouter"]);
  assert.deepEqual(warns, [
    "NVIDIA_API_KEY contains a non-ASCII character; NVIDIA is disabled until the key is fixed.",
    "OPENROUTER_API_KEY contains a non-ASCII character; OpenRouter is disabled until the key is fixed.",
  ]);
});

test("an auto-corrected dash is turned back into two hyphens", () => {
  const warns: string[] = [];
  const c = loadConfig({ NVIDIA_API_KEY: "nvapi\u2014ab", OPENROUTER_API_KEY: "sk-or\u2013ab" }, m => warns.push(m), "/h");
  assert.deepEqual(c.keys, { nvidia: "nvapi--ab", openrouter: "sk-or--ab" });
  assert.deepEqual(c.rejectedKeys, []);
  assert.deepEqual(c.keyFixes, { nvidia: 'replaced "\u2014" with "--"', openrouter: 'replaced "\u2013" with "--"' });
  assert.deepEqual(warns, [
    'NVIDIA_API_KEY: replaced "\u2014" with "--" (an auto-corrected dash)',
    'OPENROUTER_API_KEY: replaced "\u2013" with "--" (an auto-corrected dash)',
  ]);
});

test("invisible characters from a copy are removed", () => {
  const warns: string[] = [];
  const c = loadConfig({ NVIDIA_API_KEY: "nv\u200bap\u00a0i" }, m => warns.push(m), "/h");
  assert.deepEqual(c.keys, { nvidia: "nvapi" });
  assert.deepEqual(c.keyFixes, { nvidia: "removed invisible characters" });
  assert.deepEqual(warns, ["NVIDIA_API_KEY: removed invisible characters"]);
});

test("a key with an inner space is rejected, surrounding space is trimmed", () => {
  const warns: string[] = [];
  const c = loadConfig({ NVIDIA_API_KEY: "  nv  ", OPENROUTER_API_KEY: "a b" }, m => warns.push(m), "/h");
  assert.deepEqual(c.keys, { nvidia: "nv" });
  assert.equal(warns.length, 1);
});
