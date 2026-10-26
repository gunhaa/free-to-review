import { homedir } from "node:os";
import { join } from "node:path";
import { PROVIDER_NAMES } from "./providers/types.js";
export const KEY_URLS = { nvidia: "https://build.nvidia.com", openrouter: "https://openrouter.ai/keys" };
export const NO_KEY = "No API key set. Run /plugin, open free-to-review, and set an NVIDIA key (build.nvidia.com) or an OpenRouter key (openrouter.ai/keys).";
// The warning for a rejected key only reaches stderr, so a tool with no usable key says it too.
export function noKeyMessage(rejected) {
    if (rejected.length === 0)
        return NO_KEY;
    const names = rejected.map(p => PROVIDER_NAMES[p]).join(" and ");
    const [subject, it] = rejected.length === 1 ? [`The ${names} API key contains`, "it is"] : [`The ${names} API keys contain`, "they are"];
    return `${subject} a non-ASCII character, so ${it} ignored. Fix ${it === "it is" ? "it" : "them"} with /plugin → free-to-review → configure, then run /reload-plugins.`;
}
// The whole request (every attempt) must finish within this time.
export const DEADLINE_MS = 300_000;
// The plugin substitutes unset userConfig values as "", and a variable it does not know
// may reach us as the literal "${...}", so both mean unset.
function value(env, name) {
    const v = env[name]?.trim();
    return v && !v.startsWith("${") ? v : undefined;
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
// A key outside printable ASCII is never valid, and fetch would throw on it in a header.
const nonAscii = (v) => /[^\x21-\x7e]/.test(v);
// "Smart dashes" turn "--" into an em or en dash, and copies from web pages carry invisible
// characters. Keys are ASCII only, so these are always copy damage and are undone.
const DASHES = /[\u2013\u2014]/g;
const INVISIBLE = /[\u00a0\u200b-\u200d\u2060\ufeff]/;
function repairKey(v) {
    const dashes = [...new Set(v.match(DASHES) ?? [])];
    const repaired = v.replace(DASHES, "--").replace(new RegExp(INVISIBLE, "g"), "");
    if (repaired === v)
        return { key: v };
    const fixes = [...(dashes.length > 0 ? [`replaced ${dashes.map(d => `"${d}"`).join(" and ")} with "--"`] : []), ...(INVISIBLE.test(v) ? ["removed invisible characters"] : [])];
    return { key: repaired, fix: fixes.join(", ") };
}
function key(env, name, provider, warn) {
    const v = value(env, name);
    if (v === undefined)
        return {};
    const { key: repaired, fix } = repairKey(v);
    if (nonAscii(repaired)) {
        warn(`${name} contains a non-ASCII character; ${PROVIDER_NAMES[provider]} is disabled until the key is fixed.`);
        return { rejected: true };
    }
    if (fix)
        warn(`${name}: ${fix}${fix.startsWith("replaced") ? " (an auto-corrected dash)" : ""}`);
    return { key: repaired, ...(fix ? { fix } : {}) };
}
export function loadConfig(env, warn, home = homedir()) {
    const keys = {};
    const rejectedKeys = [];
    const keyFixes = {};
    for (const [p, name] of [["nvidia", "NVIDIA_API_KEY"], ["openrouter", "OPENROUTER_API_KEY"]]) {
        const k = key(env, name, p, warn);
        if (k.key)
            keys[p] = k.key;
        if (k.rejected)
            rejectedKeys.push(p);
        if (k.fix)
            keyFixes[p] = k.fix;
    }
    return {
        keys,
        rejectedKeys,
        keyFixes,
        timeoutMs: integer(env, "F2R_TIMEOUT_MS", 120000, 1000, Infinity, warn),
        firstByteMs: integer(env, "F2R_FIRST_BYTE_MS", 30000, 1000, Infinity, warn),
        deadlineMs: DEADLINE_MS,
        maxPromptChars: integer(env, "F2R_MAX_PROMPT_CHARS", 100000, 1, Infinity, warn),
        dataDir: value(env, "F2R_DATA_DIR") ?? join(home, ".free-to-review"),
    };
}
