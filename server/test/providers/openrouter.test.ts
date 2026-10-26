import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_URL, MODELS_URL, createOpenRouter, filterFreeModels } from "../../src/providers/openrouter.ts";

const model = (id: string, ctx: number, over: object = {}) => ({ id, context_length: ctx, pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, ...over });

test("filters free text models, sorts by context desc then id", () => {
  const body = { data: [
    model("a/x:free", 8000), model("b/y:free", 32000), model("c/z:free", 32000),
    model("d/paid", 99000, { pricing: { prompt: "0.1", completion: "0" } }),
    model("e/img:free", 99000, { architecture: { input_modalities: ["image"], output_modalities: ["text"] } }),
    model("f/nonzero:free", 99000, { pricing: { prompt: "0", completion: "0.2" } }),
  ] };
  assert.deepEqual(filterFreeModels(body), ["b/y:free", "c/z:free", "a/x:free"]);
});

test("malformed body yields []", () => {
  assert.deepEqual(filterFreeModels({}), []);
  assert.deepEqual(filterFreeModels(null), []);
  assert.deepEqual(filterFreeModels({ data: [null, 1, { id: 5 }, { id: "x:free" }] }), []);
});

function recorder(reply: () => Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return reply();
  }) as typeof fetch;
  return { f, seen };
}

test("openrouter provider sends its headers and reasoning", async () => {
  const { f, seen } = recorder(() => Response.json({ choices: [{ message: { content: "hi" } }] }));
  const p = createOpenRouter({ fetch: f, now: () => 0, apiKey: "k" });
  assert.equal(p.id, "openrouter");
  const r = await p.call({ model: "a/x:free", prompt: "P", timeoutMs: 1000 });
  assert.deepEqual(r, { ok: true, model: "a/x:free", text: "hi" });
  assert.equal(seen[0].url, CHAT_URL);
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer k");
  assert.equal(headers.get("http-referer"), "https://github.com/gunhaa/free-to-review");
  assert.equal(headers.get("x-title"), "free-to-review");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)).reasoning, { effort: "low" });
});

test("openrouter provider lists free models", async () => {
  const { f, seen } = recorder(() => Response.json({ data: [model("a/x:free", 1), model("b/paid", 2, { pricing: { prompt: "1", completion: "0" } })] }));
  const p = createOpenRouter({ fetch: f, now: () => 0, apiKey: "k" });
  assert.deepEqual(await p.listModels(), ["a/x:free"]);
  assert.equal(seen[0].url, MODELS_URL);
});
