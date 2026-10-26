import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// A file saved by a Windows editor may start with a byte order mark.
export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

// Writes a temporary file and renames it, so a reader never sees half a file.
export function writeAtomic(path: string, dir: string, body: unknown): void {
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(tmp, path);
}
