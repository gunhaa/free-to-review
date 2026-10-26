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

test("loads .md files in name order; invalid names skipped with a warning", () => {
  const root = mkdtempSync(join(tmpdir(), "f2r-presets-"));
  writeFileSync(join(root, "review.md"), "---\ndescription: R\n---\nbody r");
  writeFileSync(join(root, "mine.md"), "---\ndescription: Mine\n---\nmine");
  writeFileSync(join(root, "Bad_Name.md"), "bad");
  writeFileSync(join(root, "notes.txt"), "ignored");
  const warns: string[] = [];
  const m = loadPresets(root, w => warns.push(w));
  assert.deepEqual([...m.keys()], ["mine", "review"]);
  assert.equal(m.get("review")!.description, "R");
  assert.equal(warns.length, 1);
  assert.match(warns[0], /Bad_Name/);
});

test("the only built-in preset is review, with a description and a 'nothing found' phrase", () => {
  const m = loadPresets(BUILTIN_PRESETS_DIR, noWarn);
  assert.deepEqual([...m.keys()], ["review"]);
  assert.match(m.get("review")!.body, /No issues found\./);
  assert.ok(m.get("review")!.description.length > 0);
});

test("unusable preset paths are skipped with a warning, not a crash", () => {
  const root = mkdtempSync(join(tmpdir(), "f2r-presets-"));
  const file = join(root, "not-a-dir");
  writeFileSync(file, "x");
  mkdirSync(join(root, "folder.md"));
  writeFileSync(join(root, "ok.md"), "fine");
  const warns: string[] = [];
  assert.equal(loadPresets(file, w => warns.push(w)).size, 0);
  const m = loadPresets(root, w => warns.push(w));
  assert.deepEqual([...m.keys()], ["ok"]);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /not-a-dir/);
  assert.match(warns[1], /folder\.md/);
});
