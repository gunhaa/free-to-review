import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS_URL, createModelSource, filterFreeModels, pickPanel, vendorOf } from "../src/models.ts";

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
const ok = () => Response.json({ data: [model("a/x:free", 1)] });

test("caches for ttl, refetches after", async () => {
  let t = 0;
  const { f, urls } = fakeFetch([ok, ok]);
  const src = createModelSource({ fetch: f, now: () => t });
  assert.deepEqual(await src.getFreeModels(), ["a/x:free"]);
  assert.equal(urls.length, 1);
  assert.equal(urls[0], MODELS_URL);
  t = 3_599_999;
  await src.getFreeModels();
  assert.equal(urls.length, 1);
  t = 3_600_001;
  await src.getFreeModels();
  assert.equal(urls.length, 2);
});

test("fetch failure throws and is not cached", async () => {
  const { f, urls } = fakeFetch([() => new Response("", { status: 500 }), () => { throw new TypeError("fetch failed"); }, ok]);
  const src = createModelSource({ fetch: f, now: () => 0 });
  await assert.rejects(src.getFreeModels(), /Model list request failed: HTTP 500/);
  await assert.rejects(src.getFreeModels(), /fetch failed/);
  assert.deepEqual(await src.getFreeModels(), ["a/x:free"]);
  assert.equal(urls.length, 3);
});

test("vendorOf", () => {
  assert.equal(vendorOf("a/x:free"), "a");
  assert.equal(vendorOf("solo"), "solo");
});

test("pickPanel chooses distinct vendors in order", () => {
  assert.deepEqual(pickPanel(["a/1", "a/2", "b/1", "c/1"], 2), ["a/1", "b/1"]);
  assert.deepEqual(pickPanel(["a/1", "a/2"], 3), ["a/1"]);
});

test("discovery times out", async () => {
  const f = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as typeof fetch;
  const src = createModelSource({ fetch: f, now: () => 0, timeoutMs: 10 });
  await assert.rejects(src.getFreeModels(), /Model list request timed out after 10 ms/);
});
