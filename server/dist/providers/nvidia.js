import { isRecord } from "../guards.js";
import { createChatCaller, createListSource } from "./http.js";
export const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
// Only data[].id is meaningful: the other fields (e.g. created) are the same for every model.
export function parseNvidiaModels(body) {
    if (!isRecord(body) || !Array.isArray(body.data))
        return [];
    return body.data.flatMap(m => (isRecord(m) && typeof m.id === "string" ? [m.id] : []));
}
export function createNvidia(deps) {
    return {
        id: "nvidia",
        // The model list is public, so it is fetched without the key.
        listModels: createListSource({ fetch: deps.fetch, now: deps.now, url: NVIDIA_MODELS_URL, parse: parseNvidiaModels, timeoutMs: deps.listTimeoutMs }),
        call: createChatCaller({
            fetch: deps.fetch,
            now: deps.now,
            url: NVIDIA_CHAT_URL,
            apiKey: deps.apiKey,
            authFailure403: true,
            ...(deps.firstByteMs !== undefined ? { stream: { firstByteMs: deps.firstByteMs } } : {}),
        }),
    };
}
