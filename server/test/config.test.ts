import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

const noWarn = () => {};

test("defaults", () => {
  const c = loadConfig({}, noWarn);
  assert.deepEqual(c, { apiKey: undefined, panel: 1, models: [], timeoutMs: 120000, maxPromptChars: 100000 });
});

test("empty strings from plugin substitution mean defaults, no warning", () => {
  const warns: string[] = [];
  const c = loadConfig({ OPENROUTER_API_KEY: "", F2R_PANEL: "", F2R_MODELS: "" }, m => warns.push(m));
  assert.equal(c.apiKey, undefined);
  assert.equal(c.panel, 1);
  assert.deepEqual(c.models, []);
  assert.equal(warns.length, 0);
});

test("parses values", () => {
  const c = loadConfig({ OPENROUTER_API_KEY: "k", F2R_PANEL: "3", F2R_MODELS: " a/x:free, b/y:free ,", F2R_TIMEOUT_MS: "5000", F2R_MAX_PROMPT_CHARS: "10" }, noWarn);
  assert.equal(c.apiKey, "k");
  assert.equal(c.panel, 3);
  assert.deepEqual(c.models, ["a/x:free", "b/y:free"]);
  assert.equal(c.timeoutMs, 5000);
  assert.equal(c.maxPromptChars, 10);
});

test("out of range or non-numeric falls back with a warning", () => {
  const warns: string[] = [];
  const c = loadConfig({ F2R_PANEL: "4", F2R_TIMEOUT_MS: "abc" }, m => warns.push(m));
  assert.equal(c.panel, 1);
  assert.equal(c.timeoutMs, 120000);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /F2R_PANEL/);
});

test("non-integer values fall back with a warning", () => {
  const warns: string[] = [];
  const c = loadConfig({ F2R_PANEL: "1.5", F2R_MAX_PROMPT_CHARS: "0" }, m => warns.push(m));
  assert.equal(c.panel, 1);
  assert.equal(c.maxPromptChars, 100000);
  assert.equal(warns.length, 2);
});
