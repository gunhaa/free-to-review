// The plugin substitutes unset userConfig values as "", so empty means unset.
function value(env, name) {
    const v = env[name]?.trim();
    return v ? v : undefined;
}
function integer(env, name, fallback, min, max, warn) {
    const raw = value(env, name);
    if (raw === undefined)
        return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
        const range = max === Infinity ? `an integer >= ${min}` : `an integer from ${min} to ${max}`;
        warn(`${name}="${raw}" is not ${range}; using ${fallback}`);
        return fallback;
    }
    return n;
}
export function loadConfig(env, warn) {
    return {
        apiKey: value(env, "OPENROUTER_API_KEY"),
        panel: integer(env, "F2R_PANEL", 1, 1, 3, warn),
        models: (env.F2R_MODELS ?? "").split(",").map(s => s.trim()).filter(s => s.length > 0),
        timeoutMs: integer(env, "F2R_TIMEOUT_MS", 120000, 1000, Infinity, warn),
        maxPromptChars: integer(env, "F2R_MAX_PROMPT_CHARS", 100000, 1, Infinity, warn),
    };
}
