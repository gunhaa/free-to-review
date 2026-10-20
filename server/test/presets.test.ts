import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_PRESETS_DIR, loadPresets, parsePreset } from "../src/presets.ts";

const noWarn = () => {};

test("parses front matter", () => {
  const p = parsePreset("review", "---\ndescription: Find bugs.\n---\nYou are a reviewer.\n");
  assert.deepEqual(p, { name: "review", description: "Find bugs.", body: "You are a reviewer." });
});

test("CRLF line endings", () => {
  const p = parsePreset("x", "---\r\ndescription: D\r\n---\r\nLine1\r\nLine2\r\n");
  assert.equal(p.description, "D");
  assert.equal(p.body, "Line1\nLine2");
});

test("no front matter: empty description, whole text is body", () => {
  assert.deepEqual(parsePreset("x", "Just a prompt"), { name: "x", description: "", body: "Just a prompt" });
});

test("user dir overrides and adds; invalid names skipped with warning; missing dir ok", () => {
  const root = mkdtempSync(join(tmpdir(), "f2r-presets-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "review.md"), "---\ndescription: A\n---\nbody a");
  writeFileSync(join(b, "review.md"), "---\ndescription: B\n---\nbody b");
  writeFileSync(join(b, "mine.md"), "---\ndescription: Mine\n---\nmine");
  writeFileSync(join(b, "Bad_Name.md"), "bad");
  writeFileSync(join(b, "notes.txt"), "ignored");
  const warns: string[] = [];
  const m = loadPresets([a, b, "/does/not/exist"], w => warns.push(w));
  assert.deepEqual([...m.keys()], ["mine", "review"]);
  assert.equal(m.get("review")!.description, "B");
  assert.equal(warns.length, 1);
  assert.match(warns[0], /Bad_Name/);
});

test("built-in presets exist with descriptions and 'nothing found' phrases", () => {
  const m = loadPresets([BUILTIN_PRESETS_DIR], noWarn);
  assert.deepEqual([...m.keys()], ["critique", "edge-cases", "review"]);
  assert.match(m.get("review")!.body, /No issues found\./);
  assert.match(m.get("critique")!.body, /No significant concerns\./);
  assert.match(m.get("edge-cases")!.body, /No additional edge cases\./);
  for (const p of m.values()) assert.ok(p.description.length > 0);
});

test("unusable preset paths are skipped with a warning, not a crash", () => {
  const root = mkdtempSync(join(tmpdir(), "f2r-presets-"));
  const file = join(root, "not-a-dir");
  writeFileSync(file, "x");
  mkdirSync(join(root, "folder.md"));
  writeFileSync(join(root, "ok.md"), "fine");
  const warns: string[] = [];
  const m = loadPresets([file, root], w => warns.push(w));
  assert.deepEqual([...m.keys()], ["ok"]);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /not-a-dir/);
  assert.match(warns[1], /folder\.md/);
});
