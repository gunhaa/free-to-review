import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_URL, createCaller } from "../src/openrouter.ts";

type Reply = (init: RequestInit) => Response | Promise<Response>;

function setup(reply: Reply, timeoutMs = 1000) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return reply(init ?? {});
  }) as typeof fetch;
  return { call: createCaller({ fetch: f, apiKey: "k", timeoutMs }), seen };
}

const content = (c: unknown) => () => Response.json({ choices: [{ message: { content: c } }] });
const status = (s: number, body: unknown = {}, headers: Record<string, string> = {}) => () => Response.json(body, { status: s, headers });

test("sends expected request and returns trimmed text", async () => {
  const { call, seen } = setup(content("  hi \n"));
  const r = await call({ model: "a/x:free", system: "S", prompt: "P" });
  assert.deepEqual(r, { ok: true, model: "a/x:free", text: "hi" });
  assert.equal(seen[0].url, CHAT_URL);
  assert.equal(seen[0].init.method, "POST");
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer k");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("http-referer"), "https://github.com/gunhaa/free-to-review");
  assert.equal(headers.get("x-title"), "free-to-review");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), {
    model: "a/x:free",
    temperature: 0.2,
    reasoning: { effort: "low" },
    messages: [{ role: "system", content: "S" }, { role: "user", content: "P" }],
  });
});

test("omits system message when system is undefined or empty", async () => {
  for (const system of [undefined, ""]) {
    const { call, seen } = setup(content("x"));
    await call({ model: "m", system, prompt: "P" });
    assert.deepEqual(JSON.parse(String(seen[0].init.body)).messages, [{ role: "user", content: "P" }]);
  }
});

for (const s of [403, 404, 408, 429, 500, 503]) {
  test(`HTTP ${s} is retryable`, async () => {
    const { call } = setup(status(s));
    assert.deepEqual(await call({ model: "m", prompt: "P" }), { ok: false, model: "m", retryable: true, status: s, message: `HTTP ${s}` });
  });
}

for (const s of [400, 401, 402, 422]) {
  test(`HTTP ${s} is not retryable`, async () => {
    const { call } = setup(status(s));
    const r = await call({ model: "m", prompt: "P" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.retryable, false);
    assert.equal(!r.ok && r.status, s);
  });
}

test("429 exposes resetAt and error.message", async () => {
  const { call } = setup(status(429, { error: { message: "Rate limit exceeded" } }, { "x-ratelimit-reset": "1760000000000" }));
  const r = await call({ model: "m", prompt: "P" });
  assert.ok(!r.ok);
  assert.equal(r.resetAt, 1760000000000);
  assert.equal(r.message, "Rate limit exceeded");
});

test("403 for a gated model keeps the provider's message", async () => {
  const { call } = setup(status(403, { error: { message: "m is only available on agentic harnesses.", code: 403 } }));
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, status: 403, message: "m is only available on agentic harnesses." });
});

test("HTTP 200 with error body is retryable", async () => {
  const { call } = setup(status(200, { error: { message: "Provider returned error", code: 502 } }));
  const r = await call({ model: "m", prompt: "P" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.retryable, true);
  assert.equal(!r.ok && r.message, "Provider returned error");
});

test("null or empty content is retryable 'empty answer'", async () => {
  for (const c of [null, "", "  \n"]) {
    const { call } = setup(content(c));
    const r = await call({ model: "m", prompt: "P" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.retryable, true);
    assert.equal(!r.ok && r.message, "empty answer");
  }
});

test("network error is retryable", async () => {
  const { call } = setup(() => { throw new TypeError("fetch failed"); });
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, message: "fetch failed" });
});

test("timeout is retryable", async () => {
  const { call } = setup(init => new Promise((_, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }), 10);
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, message: "timeout after 10 ms" });
});

test("a timeout while the body is still streaming is reported as a timeout, not invalid JSON", async () => {
  // OpenRouter sends 200 headers at once, then whitespace keep-alives until the answer is ready.
  const { call } = setup(
    init =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("\n   \n"));
            init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    10,
  );
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, message: "timeout after 10 ms" });
});

test("HTTP 200 with a non-JSON body is retryable", async () => {
  const { call } = setup(() => new Response("<html>", { status: 200 }));
  const r = await call({ model: "m", prompt: "P" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.retryable, true);
  assert.equal(!r.ok && r.message, "invalid JSON response");
});
