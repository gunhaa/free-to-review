import { isRecord } from "../guards.ts";
import { errorMessage } from "./body.ts";
import { readChatStream } from "./sse.ts";
import type { CallOptions, ChatResult } from "./types.ts";

const DEFAULT_TTL_MS = 3_600_000;
const DEFAULT_LIST_TIMEOUT_MS = 60_000;

// 403 is per model (moderation, or free models gated to listed apps), so another model may work.
const RETRYABLE_STATUS = new Set([403, 404, 408, 429]);

// Reasoning models may answer content: null with only reasoning_content; that is no answer.
function answerText(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.choices)) return "";
  const choice: unknown = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return "";
  const c = choice.message.content;
  return typeof c === "string" ? c.trim() : "";
}

function resetAt(headers: Headers, now: number): number | undefined {
  const reset = Number(headers.get("x-ratelimit-reset") ?? NaN);
  if (Number.isFinite(reset)) return reset;
  const after = Number(headers.get("retry-after") ?? NaN);
  return Number.isFinite(after) ? now + after * 1000 : undefined;
}

// An OpenAI-compatible chat completions caller.
export function createChatCaller(deps: {
  fetch: typeof fetch;
  now: () => number;
  url: string;
  apiKey: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  // Streams the answer and gives up when no event arrives within firstByteMs (a queued model).
  stream?: { firstByteMs: number };
  // NVIDIA rejects a bad key with 403 "Authorization failed"; elsewhere a 403 is per model.
  authFailure403?: boolean;
}): (o: Omit<CallOptions, "provider">) => Promise<ChatResult> {
  return async ({ model, system, prompt, timeoutMs }) => {
    const messages = system ? [{ role: "system", content: system }, { role: "user", content: prompt }] : [{ role: "user", content: prompt }];
    const controller = new AbortController();
    let abortReason: "firstByte" | "timeout" | undefined;
    const timer = setTimeout(() => {
      abortReason = "timeout";
      controller.abort();
    }, timeoutMs);
    // At or past timeoutMs the overall timer fires first, so the message names the timeout.
    const firstByteMs = deps.stream?.firstByteMs;
    const firstByteTimer =
      firstByteMs !== undefined && firstByteMs < timeoutMs
        ? setTimeout(() => {
            abortReason = "firstByte";
            controller.abort();
          }, firstByteMs)
        : undefined;
    try {
      const res = await deps.fetch(deps.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json", ...deps.headers },
        body: JSON.stringify({ model, messages, temperature: 0.2, ...deps.extraBody, ...(deps.stream ? { stream: true } : {}) }),
        signal: controller.signal,
      });
      if (deps.stream && res.ok && res.body) {
        const outcome = await readChatStream(res.body, () => clearTimeout(firstByteTimer));
        if (outcome.kind === "error") return { ok: false, model, retryable: true, message: outcome.message };
        if (outcome.kind === "truncated") return { ok: false, model, retryable: true, message: "stream ended early" };
        const text = outcome.text.trim();
        if (!text) return { ok: false, model, retryable: true, message: "empty answer" };
        return { ok: true, model, text };
      }
      // Read the body inside the try: providers may send headers at once and the answer much later,
      // so the timeout usually fires here, and that must be reported as a timeout.
      const raw = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      if (!res.ok) {
        const reset = resetAt(res.headers, deps.now());
        const message = errorMessage(body) ?? `HTTP ${res.status}`;
        if (res.status === 401 || (deps.authFailure403 && res.status === 403 && /authoriz/i.test(message))) {
          return { ok: false, model, retryable: false, status: res.status, keyRejected: true, message };
        }
        return {
          ok: false,
          model,
          retryable: RETRYABLE_STATUS.has(res.status) || res.status >= 500,
          status: res.status,
          message,
          ...(reset !== undefined ? { resetAt: reset } : {}),
        };
      }
      // OpenRouter reports upstream provider failures as HTTP 200 with an error body.
      const upstream = errorMessage(body);
      if (upstream !== undefined) return { ok: false, model, retryable: true, status: res.status, message: upstream };
      if (body === undefined) return { ok: false, model, retryable: true, status: res.status, message: "invalid JSON response" };
      const text = answerText(body);
      if (!text) return { ok: false, model, retryable: true, status: res.status, message: "empty answer" };
      return { ok: true, model, text };
    } catch (err) {
      const message =
        abortReason === "firstByte"
          ? `no output within ${firstByteMs} ms (likely queued)`
          : abortReason === "timeout"
            ? `timeout after ${timeoutMs} ms`
            : err instanceof Error
              ? err.message
              : String(err);
      return { ok: false, model, retryable: true, message };
    } finally {
      clearTimeout(timer);
      clearTimeout(firstByteTimer);
    }
  };
}

// Fetches and parses a model list, cached for ttlMs. Failures throw and are not cached.
export function createListSource(deps: {
  fetch: typeof fetch;
  now: () => number;
  url: string;
  parse: (body: unknown) => string[];
  ttlMs?: number;
  timeoutMs?: number;
}): () => Promise<string[]> {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
  let cache: { at: number; models: string[] } | undefined;
  return async () => {
    if (cache && deps.now() - cache.at < ttlMs) return cache.models;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await deps.fetch(deps.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Model list request failed: HTTP ${res.status}`);
      const models = deps.parse(await res.json());
      cache = { at: deps.now(), models };
      return models;
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`Model list request timed out after ${timeoutMs} ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
