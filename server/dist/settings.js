import { join } from "node:path";
import { readJson, writeAtomic } from "./files.js";
import { isRecord } from "./guards.js";
import { PROVIDER_CHOICES, isProviderId } from "./providers/types.js";
export const SETTINGS_FILE = "settings.json";
export function settingsPath(dataDir) {
    return join(dataDir, SETTINGS_FILE);
}
// How many of the recommended models to use; the models command offers these.
export const TOP_SIZES = [3, 5, 10];
export const isTopSize = (v) => TOP_SIZES.includes(v);
// The file may be edited by hand, so a bad entry is reported and skipped, not fatal.
export function loadSettings(dataDir) {
    const path = settingsPath(dataDir);
    let body;
    try {
        body = readJson(path);
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT")
            return { models: {}, problems: [] };
        const problem = err instanceof SyntaxError ? `${path} is not valid JSON` : `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`;
        return { models: {}, problems: [problem] };
    }
    if (!isRecord(body) || body.version !== 1)
        return { models: {}, problems: [`${path} must have "version": 1`] };
    const settings = { models: {}, problems: [] };
    if (body.preferred !== undefined) {
        if (isProviderId(body.preferred))
            settings.preferred = body.preferred;
        else
            settings.problems.push(`preferred must be ${PROVIDER_CHOICES}`);
    }
    if (body.models !== undefined && !isRecord(body.models))
        settings.problems.push("models is not an object");
    else if (body.models !== undefined) {
        for (const [p, size] of Object.entries(body.models)) {
            if (!isProviderId(p))
                settings.problems.push(`models.${p}: unknown provider`);
            else if (isTopSize(size))
                settings.models[p] = size;
            else
                settings.problems.push(`models.${p} must be ${TOP_SIZES.join(", ")}`);
        }
    }
    return settings;
}
// Changes only the patched fields; everything else in the file is kept as written. A file that
// exists but cannot be parsed is never replaced, so a hand edit with a typo is not lost.
export function saveSettings(dataDir, patch) {
    const path = settingsPath(dataDir);
    let body = {};
    try {
        const raw = readJson(path);
        if (isRecord(raw))
            body = raw;
    }
    catch (err) {
        if (err.code !== "ENOENT") {
            throw new Error(err instanceof SyntaxError ? `${path} is not valid JSON; fix or delete it first` : `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (patch.preferred !== undefined)
        body.preferred = patch.preferred;
    if (patch.models !== undefined)
        body.models = { ...(isRecord(body.models) ? body.models : {}), ...patch.models };
    delete body.version;
    writeAtomic(path, dataDir, { version: 1, ...body });
}
