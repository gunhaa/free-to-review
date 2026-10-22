export interface Config {
  apiKey: string | undefined;
  panel: number;
  models: string[];
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

// Only free models may be called, so a paid ID in F2R_MODELS is dropped rather than used.
function freeModels(env: Env, warn: (msg: string) => void): string[] {
  const ids = (env.F2R_MODELS ?? "").split(",").map(s => s.trim()).filter(s => s.length > 0);
  const paid = ids.filter(id => !id.endsWith(":free"));
  if (paid.length > 0) warn(`F2R_MODELS: ignoring models that do not end in ":free": ${paid.join(", ")}`);
  return ids.filter(id => id.endsWith(":free"));
}

export function loadConfig(env: Env, warn: (msg: string) => void): Config {
  return {
    apiKey: value(env, "OPENROUTER_API_KEY"),
    panel: integer(env, "F2R_PANEL", 1, 1, 3, warn),
    models: freeModels(env, warn),
    timeoutMs: integer(env, "F2R_TIMEOUT_MS", 120000, 1000, Infinity, warn),
    maxPromptChars: integer(env, "F2R_MAX_PROMPT_CHARS", 100000, 1, Infinity, warn),
  };
}
