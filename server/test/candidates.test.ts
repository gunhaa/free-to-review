import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PRIORITY } from "../src/catalog.ts";
import { DEFAULT_SET_SIZE, MAX_PER_PROVIDER, createAttemptPlanner, topSet, fetchLive, planAttempts, resolvePreferred } from "../src/candidates.ts";
import type { PlanInput } from "../src/candidates.ts";
import { recommend } from "../src/catalog.ts";
import { writeFileSync } from "node:fs";
import { settingsPath } from "../src/settings.ts";
import type { TopSize } from "../src/settings.ts";
import type { State } from "../src/state.ts";
import type { Provider, ProviderId } from "../src/providers/types.ts";

const NV = DEFAULT_PRIORITY.nvidia;
const OR = DEFAULT_PRIORITY.openrouter;
const live = (nv: string[] | undefined, or: string[] | undefined) =>
  new Map<ProviderId, string[] | undefined>([["nvidia", nv], ["openrouter", or]]);

const provider = (id: ProviderId, list: () => Promise<string[]>): Provider => ({ id, listModels: list, call: async o => ({ ok: true, model: o.model, text: "" }) });

test("fetchLive maps a failed list to undefined", async () => {
  const m = await fetchLive(new Map([["nvidia", provider("nvidia", async () => ["a/x"])], ["openrouter", provider("openrouter", async () => { throw new Error("down"); })]]));
  assert.deepEqual([...m], [["nvidia", ["a/x"]], ["openrouter", undefined]]);
});

describe("planAttempts", () => {
  const NOW = 1000;
  const empty = (): State => ({ blockedModels: new Map(), blockedProviders: new Map() });
  const seq = (...xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };
  // A live list of four built-in models, so the top 5 is exactly these four, in this order.
  const SET = NV.slice(0, 4);
  const [, b, c, d] = SET;
  const input = (o: Partial<PlanInput> = {}): PlanInput => ({
    active: ["nvidia"],
    top: { nvidia: 5 },
    live: live(SET, undefined),
    state: empty(),
    now: NOW,
    random: seq(0),
    ...o,
  });
  // Fisher-Yates with random() always 0 on [a,b,c,d] gives [b,c,d,a].
  const SHUFFLED = [b, c, d];
  const ids = (p: { attempts: { provider: ProviderId; model: string }[] }) => p.attempts.map(a => `${a.provider} ${a.model}`);

  test("constants", () => {
    assert.equal(MAX_PER_PROVIDER, 3);
    assert.equal(DEFAULT_SET_SIZE, 5);
  });

  test("resolvePreferred", () => {
    assert.equal(resolvePreferred([]), undefined);
    assert.deepEqual(resolvePreferred(["openrouter"]), { provider: "openrouter", inferred: false });
    assert.deepEqual(resolvePreferred(["nvidia", "openrouter"]), { provider: "nvidia", inferred: true });
    assert.deepEqual(resolvePreferred(["nvidia", "openrouter"], "openrouter"), { provider: "openrouter", inferred: false });
    assert.deepEqual(resolvePreferred(["openrouter"], "nvidia"), { provider: "openrouter", inferred: false });
  });

  test("topSet", () => {
    assert.deepEqual(topSet("nvidia", undefined, 5), NV.slice(0, 5));
    assert.deepEqual(topSet("openrouter", OR, 3), recommend("openrouter", OR).slice(0, 3));
  });

  test("no active provider plans nothing", () => {
    const p = planAttempts(input({ active: [] }));
    assert.deepEqual(p.order, []);
    assert.deepEqual(p.attempts, []);
  });

  test("preferred without a key is ignored", () => {
    const p = planAttempts(input({ active: ["openrouter"], preferred: "nvidia", live: live(undefined, OR) }));
    assert.deepEqual(p.order, ["openrouter"]);
    assert.equal(p.preferredInferred, false);
    assert.deepEqual(p.skipped, ["preferred: no key for NVIDIA"]);
    assert.ok(p.attempts.every(a => a.provider === "openrouter"));
  });

  test("two keys without preferred infer NVIDIA", () => {
    const p = planAttempts(input({ active: ["nvidia", "openrouter"], live: live(SET, OR) }));
    assert.deepEqual(p.order, ["nvidia", "openrouter"]);
    assert.equal(p.preferredInferred, true);
  });

  test("defaults when nothing is selected", () => {
    const p = planAttempts(input({ top: {}, live: live(NV, undefined) }));
    assert.equal(p.attempts.length, 3);
    const defaults = topSet("nvidia", NV, DEFAULT_SET_SIZE);
    assert.ok(p.attempts.every(a => a.provider === "nvidia" && defaults.includes(a.model)));
    assert.equal(p.usedDefaults.nvidia, true);
  });

  test("shuffles with the injected random", () => {
    const p = planAttempts(input());
    assert.deepEqual(p.attempts.map(a => a.model), SHUFFLED);
    assert.equal(p.usedDefaults.nvidia, false);
  });

  test("preferred group comes before the other", () => {
    const p = planAttempts(input({ active: ["nvidia", "openrouter"], preferred: "openrouter", live: live(SET, OR) }));
    assert.deepEqual(p.order, ["openrouter", "nvidia"]);
    assert.deepEqual(p.attempts.map(a => a.provider), ["openrouter", "openrouter", "openrouter", "nvidia", "nvidia", "nvidia"]);
  });

  test("blocked models are left out unless all are", () => {
    const one = empty();
    one.blockedModels.set(`nvidia ${b}`, NOW + 1);
    assert.ok(!planAttempts(input({ state: one })).attempts.some(a => a.model === b));
    const all = empty();
    for (const m of SET) all.blockedModels.set(`nvidia ${m}`, NOW + 1);
    assert.equal(planAttempts(input({ state: all })).attempts.length, 3);
    const expired = empty();
    expired.blockedModels.set(`nvidia ${b}`, NOW);
    assert.deepEqual(planAttempts(input({ state: expired })).attempts.map(a => a.model), SHUFFLED);
  });

  test("blocked provider is left out", () => {
    const st = empty();
    st.blockedProviders.set("nvidia", NOW + 1);
    const p = planAttempts(input({ active: ["nvidia", "openrouter"], live: live(SET, OR), state: st }));
    assert.deepEqual(p.order, ["nvidia", "openrouter"]);
    assert.ok(p.attempts.length > 0 && p.attempts.every(a => a.provider === "openrouter"));
  });

  test("sticky first", () => {
    const st = empty();
    st.sticky = { provider: "nvidia", model: d, until: NOW + 1 };
    const p = planAttempts(input({ state: st }));
    assert.equal(p.attempts[0].model, d);
    assert.equal(p.attempts.length, 3);
    assert.equal(new Set(p.attempts.map(a => a.model)).size, 3);
  });

  test("sticky from the fallback provider goes first", () => {
    const st = empty();
    st.sticky = { provider: "openrouter", model: OR[0], until: NOW + 1 };
    const p = planAttempts(input({ active: ["nvidia", "openrouter"], live: live(SET, OR), state: st }));
    assert.equal(ids(p)[0], `openrouter ${OR[0]}`);
    assert.deepEqual(p.attempts.map(a => a.provider), ["openrouter", "nvidia", "nvidia", "nvidia", "openrouter", "openrouter"]);
    assert.equal(ids(p).filter(id => id === `openrouter ${OR[0]}`).length, 1);
  });

  for (const [name, change] of [
    ["sticky outside the set is ignored", (st: State) => (st.sticky = { provider: "nvidia", model: "zzz", until: NOW + 1 })],
    ["expired sticky is ignored", (st: State) => (st.sticky = { provider: "nvidia", model: d, until: NOW })],
    ["blocked sticky is ignored", (st: State) => ((st.sticky = { provider: "nvidia", model: d, until: NOW + 1 }), st.blockedModels.set(`nvidia ${d}`, NOW + 1))],
  ] as const) {
    test(name, () => {
      const st = empty();
      change(st);
      const p = planAttempts(input({ state: st }));
      assert.notEqual(p.attempts[0].model, st.sticky?.model);
    });
  }

  test("sticky of a blocked provider is ignored", () => {
    const st = empty();
    st.sticky = { provider: "nvidia", model: d, until: NOW + 1 };
    st.blockedProviders.set("nvidia", NOW + 1);
    const p = planAttempts(input({ active: ["nvidia", "openrouter"], live: live(SET, OR), state: st }));
    assert.ok(p.attempts.every(a => a.provider === "openrouter"));
  });

  test("sticky of a provider without a key is ignored", () => {
    const st = empty();
    st.sticky = { provider: "openrouter", model: OR[0], until: NOW + 1 };
    const p = planAttempts(input({ state: st }));
    assert.ok(p.attempts.every(a => a.provider === "nvidia"));
  });

  test("createAttemptPlanner reads settings and warns once", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "f2r-"));
    writeFileSync(settingsPath(dataDir), JSON.stringify({ version: 1, preferred: "openrouter", models: { nvidia: 3, foo: 3 } }));
    const provider: Provider = { id: "nvidia", listModels: async () => SET, call: async () => ({ ok: true, model: "a", text: "" }) };
    const warns: string[] = [];
    const plan = createAttemptPlanner({ providers: new Map([["nvidia", provider]]), dataDir, random: seq(0), warn: m => warns.push(m) });
    const p = await plan(empty(), NOW);
    await plan(empty(), NOW);
    // The top 3 of [a,b,c,d] is [a,b,c]; shuffled with random() always 0 it is [b,c,a].
    assert.deepEqual(p.attempts.map(x => x.model), [b, c, SET[0]]);
    assert.deepEqual(warns, ["settings.json: skipping models.foo: unknown provider; preferred: no key for OpenRouter"]);
  });
});

test("a chosen top size resolves to the recommendations of the live list at request time", () => {
  const empty = { blockedModels: new Map(), blockedProviders: new Map() };
  const plan = (nvLive: string[] | undefined, top?: TopSize) =>
    planAttempts({ active: ["nvidia"], top: top === undefined ? {} : { nvidia: top }, live: live(nvLive, undefined), state: empty, now: 0, random: () => 0 });
  const grown = [...NV, "deepseek-ai/deepseek-v9-new"];
  const p = plan(grown, 3);
  assert.equal(p.usedDefaults.nvidia, false);
  assert.ok(p.attempts.every(a => topSet("nvidia", grown, 3).includes(a.model)));
  assert.equal(plan(grown).usedDefaults.nvidia, true);
  // Without a live list, the built-in order stands in.
  assert.ok(plan(undefined, 10).attempts.every(a => topSet("nvidia", undefined, 10).includes(a.model)));
});
