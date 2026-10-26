import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PRIORITY, recommend, sizeOf, vendorOf } from "../src/catalog.ts";
import { parseNvidiaModels } from "../src/providers/nvidia.ts";
import { filterFreeModels } from "../src/providers/openrouter.ts";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const nv = parseNvidiaModels(JSON.parse(readFileSync(fixture("nvidia-models.json"), "utf8")));
const or = filterFreeModels(JSON.parse(readFileSync(fixture("openrouter-models.json"), "utf8")));

test("sizeOf", () => {
  assert.equal(sizeOf("mistralai/mixtral-8x22b-v0.1"), 176);
  assert.equal(sizeOf("nvidia/nemotron-3-ultra-550b-a55b"), 550);
  assert.equal(sizeOf("deepseek-ai/deepseek-coder-6.7b-instruct"), 6.7);
  assert.equal(sizeOf("ibm/granite-3.0-3b-a800m-instruct"), 3);
  assert.equal(sizeOf("moonshotai/kimi-k2.6"), undefined);
  assert.equal(sizeOf("microsoft/phi-3-vision-128k-instruct"), undefined);
});

test("nvidia recommendation starts with the built-in order", () => {
  assert.deepEqual(recommend("nvidia", nv).slice(0, DEFAULT_PRIORITY.nvidia.length), DEFAULT_PRIORITY.nvidia);
});

test("nvidia defaults follow the 2026-10-22 smoke: answering models first, deprecated glm-5.3 left out", () => {
  assert.deepEqual(DEFAULT_PRIORITY.nvidia, [
    "deepseek-ai/deepseek-v4.1-flash",
    "z-ai/glm-5.3-flash",
    "openai/gpt-oss-20b",
    "google/gemma-4-31b-it",
    "moonshotai/kimi-k2.6",
    "nvidia/nemotron-3-super-120b-a12b",
  ]);
});

test("openrouter recommendation starts with the built-in order", () => {
  assert.deepEqual(recommend("openrouter", or).slice(0, 5), DEFAULT_PRIORITY.openrouter);
});

test("tail excludes non-chat, specialist and non-brand models", () => {
  const all = [...recommend("nvidia", nv), ...recommend("openrouter", or)];
  for (const bad of ["nvidia/embed-qa-4", "writer/palmyra-med-70b", "nvidia/llama3-chatqa-1.5-70b", "aisingapore/sea-lion-7b-instruct", "nvidia/nemotron-3.5-content-safety:free", "thinkingmachines/inkling:free"])
    assert.ok(!all.includes(bad), bad);
});

test("recommendation has no duplicates", () => {
  for (const list of [recommend("nvidia", nv), recommend("openrouter", or)]) assert.equal(new Set(list).size, list.length);
});

test("with no built-in match, brands sorted by size desc, unsized last, then id", () => {
  assert.deepEqual(recommend("nvidia", ["moonshotai/kimi-k3", "google/gemma-3-12b-it", "meta/llama2-70b", "writer/palmyra-fin-70b-32k", "z-ai/glm-5.3-x"]),
    ["meta/llama2-70b", "google/gemma-3-12b-it", "moonshotai/kimi-k3", "z-ai/glm-5.3-x"]);
});

test("openrouter tail keeps live (context) order", () => {
  assert.deepEqual(recommend("openrouter", ["google/b:free", "minimax/a:free"]), ["google/b:free", "minimax/a:free"]);
});

test("vendorOf normalizes aliases", () => {
  assert.equal(vendorOf("deepseek-ai/x"), "deepseek");
  assert.equal(vendorOf("deepseek/deepseek-r2:free"), "deepseek");
  assert.equal(vendorOf("nv-mistralai/mistral-nemo-12b-instruct"), "mistralai");
  assert.equal(vendorOf("meta-llama/x"), "meta");
  assert.equal(vendorOf("alibaba/x"), "qwen");
  assert.equal(vendorOf("a/x:free"), "a");
  assert.equal(vendorOf("solo"), "solo");
});
