import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../../src/providers/router.ts";
import type { CallOptions, Provider, ProviderId } from "../../src/providers/types.ts";

function fake(id: ProviderId) {
  const seen: Omit<CallOptions, "provider">[] = [];
  const provider: Provider = {
    id,
    listModels: async () => [],
    call: async o => {
      seen.push(o);
      return { ok: true, model: o.model, text: "t" };
    },
  };
  return { provider, seen };
}

test("routes by provider", async () => {
  const nv = fake("nvidia");
  const route = createRouter(new Map([["nvidia", nv.provider]]));
  const r = await route({ provider: "nvidia", model: "a", system: "S", prompt: "P", timeoutMs: 5 });
  assert.deepEqual(nv.seen, [{ model: "a", system: "S", prompt: "P", timeoutMs: 5 }]);
  assert.deepEqual(r, { ok: true, provider: "nvidia", model: "a", text: "t" });
});

test("failures carry the provider too", async () => {
  const p: Provider = { id: "openrouter", listModels: async () => [], call: async o => ({ ok: false, model: o.model, retryable: true, message: "x" }) };
  const r = await createRouter(new Map([["openrouter", p]]))({ provider: "openrouter", model: "a/x:free", prompt: "P", timeoutMs: 5 });
  assert.deepEqual(r, { ok: false, provider: "openrouter", model: "a/x:free", retryable: true, message: "x" });
});

test("unconfigured provider", async () => {
  const nv = fake("nvidia");
  const route = createRouter(new Map([["nvidia", nv.provider]]));
  assert.deepEqual(await route({ provider: "openrouter", model: "a/x:free", prompt: "P", timeoutMs: 5 }), {
    ok: false, provider: "openrouter", model: "a/x:free", retryable: false, message: "OpenRouter is not configured",
  });
  assert.equal(nv.seen.length, 0);
});
