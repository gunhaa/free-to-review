export const MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_TTL_MS = 3_600_000;
const DEFAULT_TIMEOUT_MS = 60_000;
function isRecord(v) {
    return typeof v === "object" && v !== null;
}
function includesText(v) {
    return Array.isArray(v) && v.includes("text");
}
// Keeps models that are free in name and in price and that take and return text,
// sorted by context length (largest first), then by id.
export function filterFreeModels(body) {
    if (!isRecord(body) || !Array.isArray(body.data))
        return [];
    const free = [];
    for (const m of body.data) {
        if (!isRecord(m) || typeof m.id !== "string" || !m.id.endsWith(":free"))
            continue;
        if (!isRecord(m.pricing) || m.pricing.prompt !== "0" || m.pricing.completion !== "0")
            continue;
        if (!isRecord(m.architecture) || !includesText(m.architecture.input_modalities) || !includesText(m.architecture.output_modalities))
            continue;
        free.push({ id: m.id, ctx: typeof m.context_length === "number" ? m.context_length : 0 });
    }
    free.sort((x, y) => y.ctx - x.ctx || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return free.map(m => m.id);
}
export function createModelSource(deps) {
    const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let cache;
    return {
        async getFreeModels() {
            if (cache && deps.now() - cache.at < ttlMs)
                return cache.models;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await deps.fetch(MODELS_URL, { signal: controller.signal });
                if (!res.ok)
                    throw new Error(`Model list request failed: HTTP ${res.status}`);
                const models = filterFreeModels(await res.json());
                cache = { at: deps.now(), models };
                return models;
            }
            catch (err) {
                if (controller.signal.aborted)
                    throw new Error(`Model list request timed out after ${timeoutMs} ms`);
                throw err;
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
export function vendorOf(id) {
    const slash = id.indexOf("/");
    return slash === -1 ? id : id.slice(0, slash);
}
export function pickPanel(candidates, n) {
    const picked = [];
    const vendors = new Set();
    for (const id of candidates) {
        if (picked.length >= n)
            break;
        const vendor = vendorOf(id);
        if (vendors.has(vendor))
            continue;
        vendors.add(vendor);
        picked.push(id);
    }
    return picked;
}
