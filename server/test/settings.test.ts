import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { throws } from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings, settingsPath } from "../src/settings.ts";

const dir = () => mkdtempSync(join(tmpdir(), "f2r-"));
const write = (d: string, s: string) => writeFileSync(settingsPath(d), s);

test("missing file", () => {
  assert.deepEqual(loadSettings(dir()), { models: {}, problems: [] });
});

test("invalid JSON", () => {
  const d = dir();
  write(d, "{");
  assert.deepEqual(loadSettings(d), { models: {}, problems: [`${settingsPath(d)} is not valid JSON`] });
});

test("unknown version", () => {
  const d = dir();
  write(d, JSON.stringify({ version: 2, preferred: "nvidia" }));
  assert.deepEqual(loadSettings(d), { models: {}, problems: [`${settingsPath(d)} must have "version": 1`] });
});

test("reads a valid file", () => {
  const d = dir();
  write(d, JSON.stringify({ version: 1, preferred: "openrouter", models: { nvidia: 3, openrouter: 10 } }));
  assert.deepEqual(loadSettings(d), { preferred: "openrouter", models: { nvidia: 3, openrouter: 10 }, problems: [] });
});

test("BOM is accepted", () => {
  const d = dir();
  write(d, `\ufeff${JSON.stringify({ version: 1, preferred: "nvidia" })}`);
  assert.deepEqual(loadSettings(d), { preferred: "nvidia", models: {}, problems: [] });
});

test("bad entries are skipped", () => {
  const d = dir();
  write(d, JSON.stringify({ version: 1, preferred: "x", models: { nvidia: 4, openrouter: ["a:free"], foo: 5 } }));
  const s = loadSettings(d);
  assert.equal(s.preferred, undefined);
  assert.deepEqual(s.models, {});
  assert.deepEqual(s.problems, [
    'preferred must be "nvidia" or "openrouter"',
    "models.nvidia must be 3, 5, 10",
    "models.openrouter must be 3, 5, 10",
    "models.foo: unknown provider",
  ]);
  write(d, JSON.stringify({ version: 1, models: [] }));
  assert.deepEqual(loadSettings(d).problems, ["models is not an object"]);
});

test("save keeps other fields", () => {
  const d = dir();
  saveSettings(d, { preferred: "openrouter" });
  saveSettings(d, { models: { nvidia: 3 } });
  const raw = readFileSync(settingsPath(d), "utf8");
  assert.ok(raw.endsWith("\n"));
  assert.deepEqual(JSON.parse(raw), { version: 1, preferred: "openrouter", models: { nvidia: 3 } });
  saveSettings(d, { models: { openrouter: 10 } });
  assert.deepEqual(JSON.parse(readFileSync(settingsPath(d), "utf8")).models, { nvidia: 3, openrouter: 10 });
});

test("save leaves no temp file", () => {
  const d = dir();
  saveSettings(d, { preferred: "nvidia" });
  assert.deepEqual(readdirSync(d), ["settings.json"]);
});

test("save refuses to replace a file it cannot parse", () => {
  const d = dir();
  write(d, '{ "version": 1, "models": { "nvidia": 3, } }');
  throws(() => saveSettings(d, { preferred: "nvidia" }), new RegExp(`${settingsPath(d).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not valid JSON; fix or delete it first`));
  assert.equal(readFileSync(settingsPath(d), "utf8"), '{ "version": 1, "models": { "nvidia": 3, } }');
});
