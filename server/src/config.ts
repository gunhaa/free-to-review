import { join } from "node:path";

export interface Config {
  apiKey: string | undefined;
  panel: number;
  models: string[];
  presetsDir: string;
  timeoutMs: number;
  maxPromptChars: number;
}

type Env = Record<string, string | undefined>;

// The plugin substitutes unset userConfig values as "", so empty means unset.
function value(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function integer(env: Env, name: string, fallback: number, min: number, max: number, warn: (msg: string) => void): number {
  const raw = value(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    const range = max === Infinity ? `an integer >= ${min}` : `an integer from ${min} to ${max}`;
    warn(`${name}="${raw}" is not ${range}; using ${fallback}`);
    return fallback;
  }
  return n;
}

export function loadConfig(env: Env, home: string, warn: (msg: string) => void): Config {
  const configHome = value(env, "XDG_CONFIG_HOME") ?? join(home, ".config");
  return {
    apiKey: value(env, "OPENROUTER_API_KEY"),
    panel: integer(env, "F2R_PANEL", 1, 1, 3, warn),
    models: (env.F2R_MODELS ?? "").split(",").map(s => s.trim()).filter(s => s.length > 0),
    presetsDir: value(env, "F2R_PRESETS_DIR") ?? join(configHome, "free-to-review", "presets"),
    timeoutMs: integer(env, "F2R_TIMEOUT_MS", 60000, 1000, Infinity, warn),
    maxPromptChars: integer(env, "F2R_MAX_PROMPT_CHARS", 100000, 1, Infinity, warn),
  };
}
