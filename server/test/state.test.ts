import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATE_FILE, blockKey, createStateStore } from "../src/state.ts";
import type { State } from "../src/state.ts";

const dir = () => mkdtempSync(join(tmpdir(), "f2r-"));
const store = (d: string) => {
  const warns: string[] = [];
  return { s: createStateStore(d, m => warns.push(m), () => 0), warns };
};
const empty = (): State => ({ blockedModels: new Map(), blockedProviders: new Map() });

test("blockKey", () => {
  assert.equal(blockKey("nvidia", "a/b"), "nvidia a/b");
});

test("missing or broken file is empty", () => {
  const d = dir();
  const { s, warns } = store(d);
  assert.deepEqual(s.load(0), empty());
  writeFileSync(join(d, STATE_FILE), "{");
  assert.deepEqual(s.load(0), empty());
  writeFileSync(join(d, STATE_FILE), JSON.stringify({ version: 9 }));
  assert.deepEqual(s.load(0), empty());
  assert.equal(warns.length, 0);
});

test("round trip", () => {
  const d = dir();
  const { s } = store(d);
  const st: State = {
    sticky: { provider: "nvidia", model: "a", until: 100 },
    blockedModels: new Map([["nvidia b", 200]]),
    blockedProviders: new Map([["openrouter", 300]]),
  };
  s.save(st);
  assert.deepEqual(s.load(50), st);
  assert.equal(JSON.parse(readFileSync(join(d, STATE_FILE), "utf8")).version, 1);
});

test("expired entries are dropped on load", () => {
  const d = dir();
  const { s } = store(d);
  s.save({ sticky: { provider: "nvidia", model: "a", until: 100 }, blockedModels: new Map([["nvidia b", 100], ["nvidia c", 101]]), blockedProviders: new Map([["nvidia", 100]]) });
  assert.deepEqual(s.load(100), { blockedModels: new Map([["nvidia c", 101]]), blockedProviders: new Map() });
});

test("expired entries are not written", () => {
  const d = dir();
  const s = createStateStore(d, () => {}, () => 1000);
  s.save({ blockedModels: new Map([["nvidia old", 1000], ["nvidia new", 1001]]), blockedProviders: new Map() });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(d, STATE_FILE), "utf8")).blockedModels), ["nvidia new"]);
});

test("save failure warns once and does not throw", () => {
  const d = dir();
  const file = join(d, "not-a-dir");
  writeFileSync(file, "");
  const { s, warns } = store(file);
  s.save(empty());
  s.save(empty());
  assert.equal(warns.length, 1);
  assert.ok(warns[0].includes(join(file, STATE_FILE)));
});

test("ignores malformed entries", () => {
  const d = dir();
  writeFileSync(
    join(d, STATE_FILE),
    JSON.stringify({ version: 1, sticky: { provider: "x", model: "a", until: 100 }, blockedModels: { "nvidia a": "soon", "nvidia b": 100 }, blockedProviders: { foo: 100, nvidia: 100 } }),
  );
  assert.deepEqual(store(d).s.load(0), { blockedModels: new Map([["nvidia b", 100]]), blockedProviders: new Map([["nvidia", 100]]) });
});
