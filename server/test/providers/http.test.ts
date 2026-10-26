import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { createChatCaller, createListSource } from "../../src/providers/http.ts";
import { CHAT_URL } from "../../src/providers/openrouter.ts";

type Reply = (init: RequestInit) => Response | Promise<Response>;

const OPENROUTER = {
  url: CHAT_URL,
  headers: { "HTTP-Referer": "https://github.com/gunhaa/free-to-review", "X-Title": "free-to-review" },
  extraBody: { reasoning: { effort: "low" } },
};

function setup(reply: Reply, opts: { now?: () => number; authFailure403?: boolean } = {}) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return reply(init ?? {});
  }) as typeof fetch;
  const caller = createChatCaller({ fetch: f, now: opts.now ?? (() => 0), apiKey: "k", ...OPENROUTER, ...(opts.authFailure403 ? { authFailure403: true } : {}) });
  const call = (o: { model: string; system?: string; prompt: string; timeoutMs?: number }) => caller({ timeoutMs: 1000, ...o });
  return { call, seen };
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

test("HTTP 401 marks the key as rejected", async () => {
  const { call } = setup(status(401));
  assert.deepEqual(await call({ model: "m", prompt: "P" }), { ok: false, model: "m", retryable: false, status: 401, keyRejected: true, message: "HTTP 401" });
});

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
  }));
  const r = await call({ model: "m", prompt: "P", timeoutMs: 10 });
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
  );
  const r = await call({ model: "m", prompt: "P", timeoutMs: 10 });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, message: "timeout after 10 ms" });
});

test("HTTP 200 with a non-JSON body is retryable", async () => {
  const { call } = setup(() => new Response("<html>", { status: 200 }));
  const r = await call({ model: "m", prompt: "P" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.retryable, true);
  assert.equal(!r.ok && r.message, "invalid JSON response");
});

test("retry-after seconds become resetAt", async () => {
  const { call } = setup(status(429, {}, { "retry-after": "30" }), { now: () => 1_000 });
  const r = await call({ model: "m", prompt: "P", timeoutMs: 1000 });
  assert.equal(r.ok === false && r.resetAt, 31_000);
});

test("x-ratelimit-reset wins over retry-after", async () => {
  const { call } = setup(status(429, {}, { "x-ratelimit-reset": "5000", "retry-after": "30" }), { now: () => 1_000 });
  const r = await call({ model: "m", prompt: "P" });
  assert.equal(r.ok === false && r.resetAt, 5000);
});

const LIST_URL = "https://example.test/models";
const ids = (body: unknown) => (Array.isArray(body) ? body.filter((x): x is string => typeof x === "string") : []);

function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const urls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  }) as typeof fetch;
  return { f, urls };
}
const ok = () => Response.json(["a/x"]);

test("list source caches for ttl, refetches after", async () => {
  let t = 0;
  const { f, urls } = fakeFetch([ok, ok]);
  const list = createListSource({ fetch: f, now: () => t, url: LIST_URL, parse: ids });
  assert.deepEqual(await list(), ["a/x"]);
  assert.equal(urls.length, 1);
  assert.equal(urls[0], LIST_URL);
  t = 3_599_999;
  await list();
  assert.equal(urls.length, 1);
  t = 3_600_001;
  await list();
  assert.equal(urls.length, 2);
});

test("list fetch failure throws and is not cached", async () => {
  const { f, urls } = fakeFetch([() => new Response("", { status: 500 }), () => { throw new TypeError("fetch failed"); }, ok]);
  const list = createListSource({ fetch: f, now: () => 0, url: LIST_URL, parse: ids });
  await assert.rejects(list(), /Model list request failed: HTTP 500/);
  await assert.rejects(list(), /fetch failed/);
  assert.deepEqual(await list(), ["a/x"]);
  assert.equal(urls.length, 3);
});

test("list request times out", async () => {
  const f = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as typeof fetch;
  const list = createListSource({ fetch: f, now: () => 0, url: LIST_URL, parse: ids, timeoutMs: 10 });
  await assert.rejects(list(), /Model list request timed out after 10 ms/);
});

// Streaming (NVIDIA). The stream stays open until the test pushes to it or the request is aborted.
function sseResponse(init: RequestInit, chunks: string[] = [], close = false) {
  let push: (s: string) => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      push = s => controller.enqueue(enc.encode(s));
      for (const c of chunks) push(c);
      if (close) controller.close();
      init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
  });
  return { res: new Response(body, { headers: { "content-type": "text/event-stream" } }), push: (s: string) => push(s) };
}

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const piece = (c: string, finish: string | null = null) => sse({ choices: [{ delta: { content: c }, finish_reason: finish }] });
const settle = () => new Promise(r => setImmediate(r));

function setupStream(reply: Reply, firstByteMs = 30000) {
  const seen: RequestInit[] = [];
  const f = (async (_: string | URL | Request, init?: RequestInit) => {
    seen.push(init ?? {});
    return reply(init ?? {});
  }) as typeof fetch;
  const caller = createChatCaller({ fetch: f, now: () => 0, apiKey: "k", url: "https://x/chat", stream: { firstByteMs } });
  return { call: (timeoutMs = 120000) => caller({ model: "m", prompt: "P", timeoutMs }), seen };
}

test("streams when enabled", async () => {
  const { call, seen } = setupStream(init => sseResponse(init, [piece(" hi"), piece(" \n", "stop"), "data: [DONE]\n\n"]).res);
  const r = await call();
  assert.deepEqual(r, { ok: true, model: "m", text: "hi" });
  assert.equal(JSON.parse(String(seen[0].body)).stream, true);
});

test("first-byte timeout before any event", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { call } = setupStream(init => sseResponse(init).res);
    const p = call();
    await settle();
    mock.timers.tick(30000);
    assert.deepEqual(await p, { ok: false, model: "m", retryable: true, message: "no output within 30000 ms (likely queued)" });
  } finally {
    mock.timers.reset();
  }
});

test("first event clears the first-byte timer", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let push: (s: string) => void = () => {};
    const { call } = setupStream(init => {
      const s = sseResponse(init, [piece("a")]);
      push = s.push;
      return s.res;
    });
    let done = false;
    const p = call().then(r => ((done = true), r));
    await settle();
    mock.timers.tick(30000);
    await settle();
    assert.equal(done, false);
    push(piece("b"));
    mock.timers.tick(90000);
    assert.deepEqual(await p, { ok: false, model: "m", retryable: true, message: "timeout after 120000 ms" });
  } finally {
    mock.timers.reset();
  }
});

test("first-byte timer never exceeds timeoutMs", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { call } = setupStream(init => sseResponse(init).res);
    const p = call(5000);
    await settle();
    mock.timers.tick(5000);
    assert.deepEqual(await p, { ok: false, model: "m", retryable: true, message: "timeout after 5000 ms" });
  } finally {
    mock.timers.reset();
  }
});

test("truncated stream", async () => {
  const { call } = setupStream(init => sseResponse(init, [piece("a")], true).res);
  assert.deepEqual(await call(), { ok: false, model: "m", retryable: true, message: "stream ended early" });
});

test("empty streamed answer", async () => {
  const { call } = setupStream(init => sseResponse(init, [piece("", "stop"), "data: [DONE]\n\n"]).res);
  assert.deepEqual(await call(), { ok: false, model: "m", retryable: true, message: "empty answer" });
});

test("streamed error event is retryable", async () => {
  const { call } = setupStream(init => sseResponse(init, [sse({ error: { message: "overloaded" } })]).res);
  assert.deepEqual(await call(), { ok: false, model: "m", retryable: true, message: "overloaded" });
});

test("non-200 while streaming uses the error body", async () => {
  const { call } = setupStream(() => Response.json({ error: { message: "slow down" } }, { status: 429, headers: { "retry-after": "7" } }));
  assert.deepEqual(await call(), { ok: false, model: "m", retryable: true, status: 429, message: "slow down", resetAt: 7000 });
});

test("problem+json detail", async () => {
  const { call } = setup(status(403, { title: "Forbidden", detail: "Model gated" }));
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, status: 403, message: "Model gated" });
});

test("NVIDIA authorization failure is a rejected key", async () => {
  const { call } = setup(status(403, { title: "Forbidden", detail: "Authorization failed" }), { authFailure403: true });
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: false, status: 403, keyRejected: true, message: "Authorization failed" });
});

test("other providers keep an authorization 403 per model", async () => {
  const { call } = setup(status(403, { error: { message: "This model is not authorized for your account" } }));
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, status: 403, message: "This model is not authorized for your account" });
});

test("problem+json title only", async () => {
  const { call } = setup(status(404, { title: "Not Found" }));
  const r = await call({ model: "m", prompt: "P" });
  assert.deepEqual(r, { ok: false, model: "m", retryable: true, status: 404, message: "Not Found" });
});
