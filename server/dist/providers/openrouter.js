import { isRecord } from "../guards.js";
import { createChatCaller, createListSource } from "./http.js";
export const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const MODELS_URL = "https://openrouter.ai/api/v1/models";
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
export function createOpenRouter(deps) {
    return {
        id: "openrouter",
        listModels: createListSource({ fetch: deps.fetch, now: deps.now, url: MODELS_URL, parse: filterFreeModels, timeoutMs: deps.listTimeoutMs }),
        call: createChatCaller({
            fetch: deps.fetch,
            now: deps.now,
            url: CHAT_URL,
            apiKey: deps.apiKey,
            headers: { "HTTP-Referer": "https://github.com/gunhaa/free-to-review", "X-Title": "free-to-review" },
            // Some free models reason by default at maximum effort and take minutes; low keeps answers within the timeout.
            extraBody: { reasoning: { effort: "low" } },
        }),
    };
}
