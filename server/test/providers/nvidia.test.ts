import { test } from "node:test";
import assert from "node:assert/strict";
import { NVIDIA_CHAT_URL, NVIDIA_MODELS_URL, createNvidia, parseNvidiaModels } from "../../src/providers/nvidia.ts";

function recorder(reply: () => Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return reply();
  }) as typeof fetch;
  return { f, seen };
}

test("nvidia sends a plain OpenAI request", async () => {
  const { f, seen } = recorder(() => Response.json({ choices: [{ message: { content: "hi" } }] }));
  const p = createNvidia({ fetch: f, now: () => 0, apiKey: "k" });
  assert.equal(p.id, "nvidia");
  const r = await p.call({ model: "deepseek-ai/deepseek-v4.1-flash", prompt: "P", timeoutMs: 1000 });
  assert.deepEqual(r, { ok: true, model: "deepseek-ai/deepseek-v4.1-flash", text: "hi" });
  assert.equal(seen[0].url, NVIDIA_CHAT_URL);
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer k");
  assert.equal(headers.get("http-referer"), null);
  assert.equal(headers.get("x-title"), null);
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { model: "deepseek-ai/deepseek-v4.1-flash", temperature: 0.2, messages: [{ role: "user", content: "P" }] });
});

test("null content with reasoning_content is an empty answer", async () => {
  const { f } = recorder(() => Response.json({ choices: [{ message: { content: null, reasoning_content: "thinking..." } }] }));
  const r = await createNvidia({ fetch: f, now: () => 0, apiKey: "k" }).call({ model: "m", prompt: "P", timeoutMs: 1000 });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, status: 200, message: "empty answer" });
});

test("parseNvidiaModels keeps string ids in order", () => {
  assert.deepEqual(parseNvidiaModels({ data: [{ id: "a/x" }, { id: 5 }, null, { id: "b/y" }] }), ["a/x", "b/y"]);
  assert.deepEqual(parseNvidiaModels(null), []);
});

test("nvidia lists models without sending the key", async () => {
  const { f, seen } = recorder(() => Response.json({ data: [{ id: "a/x" }] }));
  assert.deepEqual(await createNvidia({ fetch: f, now: () => 0, apiKey: "k" }).listModels(), ["a/x"]);
  assert.equal(seen[0].url, NVIDIA_MODELS_URL);
  assert.equal(new Headers(seen[0].init.headers).get("authorization"), null);
});

test("turns streaming on with firstByteMs", async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const { f, seen } = recorder(() => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
  const r = await createNvidia({ fetch: f, now: () => 0, apiKey: "k", firstByteMs: 30000 }).call({ model: "m", prompt: "P", timeoutMs: 1000 });
  assert.deepEqual(r, { ok: true, model: "m", text: "hi" });
  assert.equal(JSON.parse(String(seen[0].init.body)).stream, true);
});

test("no firstByteMs means no stream field", async () => {
  const { f, seen } = recorder(() => Response.json({ choices: [{ message: { content: "hi" } }] }));
  await createNvidia({ fetch: f, now: () => 0, apiKey: "k" }).call({ model: "m", prompt: "P", timeoutMs: 1000 });
  assert.equal("stream" in JSON.parse(String(seen[0].init.body)), false);
});

test("nvidia treats 403 Authorization failed as a rejected key", async () => {
  const { f } = recorder(() => Response.json({ title: "Forbidden", detail: "Authorization failed" }, { status: 403 }));
  const r = await createNvidia({ fetch: f, now: () => 0, apiKey: "k" }).call({ model: "m", prompt: "P", timeoutMs: 1000 });
  assert.deepEqual(r, { ok: false, model: "m", retryable: false, status: 403, keyRejected: true, message: "Authorization failed" });
});
