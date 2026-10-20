export const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
// 403 is per model (moderation, or free models gated to listed apps), so another model may work.
const RETRYABLE_STATUS = new Set([403, 404, 408, 429]);
function isRecord(v) {
    return typeof v === "object" && v !== null;
}
function errorMessage(body) {
    if (!isRecord(body) || !isRecord(body.error))
        return undefined;
    const m = body.error.message;
    return typeof m === "string" && m.length > 0 ? m : "error";
}
function answerText(body) {
    if (!isRecord(body) || !Array.isArray(body.choices))
        return "";
    const choice = body.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message))
        return "";
    const c = choice.message.content;
    return typeof c === "string" ? c.trim() : "";
}
export function createCaller(deps) {
    return async ({ model, system, prompt }) => {
        const messages = system ? [{ role: "system", content: system }, { role: "user", content: prompt }] : [{ role: "user", content: prompt }];
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, deps.timeoutMs);
        try {
            const res = await deps.fetch(CHAT_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${deps.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/gunhaa/free-to-review",
                    "X-Title": "free-to-review",
                },
                body: JSON.stringify({ model, messages, temperature: 0.2 }),
                signal: controller.signal,
            });
            const body = await res.json().catch(() => undefined);
            if (!res.ok) {
                const reset = Number(res.headers.get("x-ratelimit-reset") ?? NaN);
                return {
                    ok: false,
                    model,
                    retryable: RETRYABLE_STATUS.has(res.status) || res.status >= 500,
                    status: res.status,
                    message: errorMessage(body) ?? `HTTP ${res.status}`,
                    ...(Number.isFinite(reset) ? { resetAt: reset } : {}),
                };
            }
            // OpenRouter reports upstream provider failures as HTTP 200 with an error body.
            const upstream = errorMessage(body);
            if (upstream !== undefined)
                return { ok: false, model, retryable: true, status: res.status, message: upstream };
            if (body === undefined)
                return { ok: false, model, retryable: true, status: res.status, message: "invalid JSON response" };
            const text = answerText(body);
            if (!text)
                return { ok: false, model, retryable: true, status: res.status, message: "empty answer" };
            return { ok: true, model, text };
        }
        catch (err) {
            const message = timedOut ? `timeout after ${deps.timeoutMs} ms` : err instanceof Error ? err.message : String(err);
            return { ok: false, model, retryable: true, message };
        }
        finally {
            clearTimeout(timer);
        }
    };
}
