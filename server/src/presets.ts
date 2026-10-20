import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Preset {
  name: string;
  description: string;
  body: string;
}

// Resolved relative to this file, so src/ (tests) and dist/ (runtime) both find server/presets/.
export const BUILTIN_PRESETS_DIR: string = fileURLToPath(new URL("../presets/", import.meta.url));

const NAME = /^[a-z0-9-]+$/;
const FRONT_MATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

export function parsePreset(name: string, text: string): Preset {
  const normalized = text.replace(/\r\n?/g, "\n");
  const match = FRONT_MATTER.exec(normalized);
  if (!match) return { name, description: "", body: normalized.trim() };
  let description = "";
  for (const line of match[1].split("\n")) {
    const field = /^description:\s*(.*)$/.exec(line);
    if (field) description = field[1].trim();
  }
  return { name, description, body: normalized.slice(match[0].length).trim() };
}

export function loadPresets(dirs: string[], warn: (msg: string) => void): Map<string, Preset> {
  const found = new Map<string, Preset>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch (err) {
      warn(`Skipping preset directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const name = file.slice(0, -".md".length);
      if (!NAME.test(name)) {
        warn(`Skipping preset "${file}" in ${dir}: name must match ${NAME.source}`);
        continue;
      }
      let text: string;
      try {
        text = readFileSync(join(dir, file), "utf8");
      } catch (err) {
        warn(`Skipping preset "${file}" in ${dir}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      found.set(name, parsePreset(name, text));
    }
  }
  return new Map([...found.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}
