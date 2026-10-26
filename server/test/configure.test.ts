import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_KEY } from "../src/config.ts";
import { topSet } from "../src/candidates.ts";
import { DEFAULT_PRIORITY } from "../src/catalog.ts";
import { ELICIT_TIMEOUT_MS, configureModels, configureProvider, modelsToolDefinition, providerToolDefinition } from "../src/configure.ts";
import type { ToolContext } from "../src/protocol.ts";
import type { ProviderId } from "../src/providers/types.ts";
import { saveSettings, settingsPath } from "../src/settings.ts";
import type { State, StateStore } from "../src/state.ts";

const NV = DEFAULT_PRIORITY.nvidia;
const OR = DEFAULT_PRIORITY.openrouter;
const LIVE = new Map<ProviderId, string[] | undefined>([["nvidia", NV], ["openrouter", OR]]);

function context(reply: unknown, caps: Record<string, unknown> = { elicitation: {} }) {
  const requests: { method: string; params: any; timeoutMs: number }[] = [];
  const ctx: ToolContext = {
    clientCapabilities: caps,
    // A list of replies answers successive dialogs in order.
    request: async (method, params, timeoutMs) => {
      requests.push({ method, params, timeoutMs });
      const r = Array.isArray(reply) ? reply[requests.length - 1] : reply;
      if (r instanceof Error) throw r;
      return r ?? { action: "cancel" };
    },
  };
  return { ctx, requests };
}

const dir = () => mkdtempSync(join(tmpdir(), "f2r-cfg-"));
const saved = (d: string) => (existsSync(settingsPath(d)) ? JSON.parse(readFileSync(settingsPath(d), "utf8")) : undefined);

function memoryState(initial: State) {
  let current = initial;
  const store: StateStore = { load: () => current, save: s => void (current = s) };
  return { store, get: () => current };
}

// ---------- provider ----------

function provider(opts: { reply?: unknown; caps?: Record<string, unknown>; active?: ProviderId[]; preferred?: ProviderId } = {}) {
  const dataDir = dir();
  if (opts.preferred) saveSettings(dataDir, { preferred: opts.preferred });
  const { ctx, requests } = context(opts.reply, opts.caps);
  const state = memoryState({ sticky: { provider: "nvidia", model: "a", until: 10 }, blockedModels: new Map(), blockedProviders: new Map() });
  const run = () => configureProvider({ active: opts.active ?? ["nvidia", "openrouter"], dataDir, state: state.store, now: () => 0, ctx });
  return { run, requests, dataDir, state };
}

const accept = (content: object) => ({ action: "accept", content });

test("provider tool definition", () => {
  assert.deepEqual(providerToolDefinition, {
    name: "provider",
    description: "Choose which provider free-to-review uses first. Opens a dialog.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  });
});

test("provider: no elicitation points to the file", async () => {
  const { run, requests, dataDir } = provider({ caps: {} });
  const r = await run();
  assert.equal(r.isError, true);
  assert.ok(r.text.includes(settingsPath(dataDir)));
  assert.ok(r.text.includes('{"version":1,"preferred":"nvidia"}'));
  assert.equal(requests.length, 0);
});

test("provider: no keys gives NO_KEY", async () => {
  assert.deepEqual(await provider({ active: [] }).run(), { text: NO_KEY, isError: true });
});

test("provider: offers both with status", async () => {
  const { run, requests } = provider({ active: ["nvidia"] });
  await run();
  const { method, params, timeoutMs } = requests[0];
  assert.equal(method, "elicitation/create");
  assert.equal(timeoutMs, ELICIT_TIMEOUT_MS);
  assert.deepEqual(params.requestedSchema.properties.preferred, {
    type: "string",
    title: "Provider",
    oneOf: [
      { const: "nvidia", title: "NVIDIA (recommended, key set, current)" },
      { const: "openrouter", title: "OpenRouter (no key)" },
    ],
    default: "nvidia",
  });
});

test("provider: default is the saved preference", async () => {
  const { run, requests } = provider({ preferred: "openrouter" });
  await run();
  const p = requests[0].params.requestedSchema.properties.preferred;
  assert.equal(p.default, "openrouter");
  assert.deepEqual(p.oneOf.map((o: { title: string }) => o.title), ["NVIDIA (recommended, key set)", "OpenRouter (key set, current)"]);
});

test("provider: saves and clears sticky", async () => {
  const { run, dataDir, state } = provider({ reply: accept({ preferred: "openrouter" }) });
  assert.deepEqual(await run(), { text: "Saved: OpenRouter is used first; NVIDIA is the fallback.", isError: false });
  assert.equal(saved(dataDir).preferred, "openrouter");
  assert.equal(state.get().sticky, undefined);
});

test("provider: single key", async () => {
  const { run } = provider({ active: ["nvidia"], reply: accept({ preferred: "nvidia" }) });
  assert.deepEqual(await run(), { text: "Saved: NVIDIA is used first.", isError: false });
});

test("provider: no key for the choice", async () => {
  const { run, dataDir, state } = provider({ active: ["nvidia"], reply: accept({ preferred: "openrouter" }) });
  assert.deepEqual(await run(), { text: "Not saved: OpenRouter has no API key. Set it with /plugin → free-to-review (https://openrouter.ai/keys).", isError: true });
  assert.equal(saved(dataDir), undefined);
  assert.notEqual(state.get().sticky, undefined);
});

test("provider: value outside the enum", async () => {
  const { run, dataDir } = provider({ reply: accept({ preferred: "x" }) });
  const r = await run();
  assert.equal(r.isError, true);
  assert.equal(saved(dataDir), undefined);
});

test("provider: decline and timeout", async () => {
  assert.deepEqual(await provider({ reply: { action: "decline" } }).run(), { text: "No changes.", isError: false });
  assert.deepEqual(await provider({ reply: new Error("timed out") }).run(), { text: "No changes (dialog timed out).", isError: false });
});

test("provider: a broken settings file is not replaced", async () => {
  const { run, dataDir } = provider({ reply: accept({ preferred: "openrouter" }) });
  writeFileSync(settingsPath(dataDir), "{ broken");
  const r = await run();
  assert.deepEqual(r, { text: `Not saved: ${settingsPath(dataDir)} is not valid JSON; fix or delete it first.`, isError: true });
  assert.equal(readFileSync(settingsPath(dataDir), "utf8"), "{ broken");
});

// ---------- models ----------

function models(opts: { active?: ProviderId[]; args?: Record<string, unknown>; live?: Map<ProviderId, string[] | undefined>; preferred?: ProviderId } = {}) {
  const dataDir = dir();
  if (opts.preferred) saveSettings(dataDir, { preferred: opts.preferred });
  const run = () => configureModels({ active: opts.active ?? ["nvidia"], live: async () => opts.live ?? LIVE, dataDir, args: opts.args ?? {} });
  return { run, dataDir };
}

test("models tool definition", () => {
  assert.deepEqual(modelsToolDefinition.inputSchema, {
    type: "object",
    properties: {
      nvidia: { type: "integer", enum: [3, 5, 10], description: "How many of the recommended NVIDIA models to use." },
      openrouter: { type: "integer", enum: [3, 5, 10], description: "How many of the recommended OpenRouter models to use." },
    },
    additionalProperties: false,
  });
  assert.equal(modelsToolDefinition.name, "models");
});

test("models: no keys gives NO_KEY", async () => {
  assert.deepEqual(await models({ active: [] }).run(), { text: NO_KEY, isError: true });
});

test("models: lists both providers, the preferred one first, including one without a key", async () => {
  const r = await models({ active: ["nvidia"], live: new Map([["nvidia", NV]]) }).run();
  assert.equal(r.isError, false);
  const numbered = (ids: string[]) => ids.map((id, i) => `${i + 1}. ${id}`);
  assert.equal(
    r.text,
    [
      "NVIDIA (nvidia): key set, used first.",
      "Current: top 5 (default).",
      "Recommended now:",
      ...numbered(topSet("nvidia", NV, 10)),
      "",
      "OpenRouter (openrouter): no key; used once a key is set.",
      "Current: top 5 (default).",
      "Recommended (built-in order; the live list was unavailable):",
      ...numbered(topSet("openrouter", undefined, 10)),
    ].join("\n"),
  );
});

test("models: the preferred provider is listed first and shows its saved size", async () => {
  const m = models({ active: ["nvidia", "openrouter"], preferred: "openrouter" });
  saveSettings(m.dataDir, { models: { openrouter: 10 } });
  const r = await m.run();
  assert.ok(r.text.startsWith("OpenRouter (openrouter): key set, used first.\nCurrent: top 10.\n"));
  assert.ok(r.text.includes("NVIDIA (nvidia): key set, used when the other fails."));
});

test("models: a broken settings file does not show up in the list", async () => {
  const m = models();
  writeFileSync(settingsPath(m.dataDir), JSON.stringify({ version: 1, models: { nvidia: ["a"] } }));
  const r = await m.run();
  assert.ok(!r.text.includes(settingsPath(m.dataDir)));
  assert.ok(r.text.includes("Current: top 5 (default)."));
});

test("models: saves the chosen sizes and lists the models now in them", async () => {
  const m = models({ args: { nvidia: 3, openrouter: 10 } });
  const r = await m.run();
  const list = (p: ProviderId, live: string[] | undefined, n: number) => topSet(p, live, n).map(id => `- ${id}`).join("\n");
  assert.deepEqual(r, {
    text: `Saved: NVIDIA uses the top 3 recommended models. Now:\n${list("nvidia", NV, 3)}\n\nSaved: OpenRouter uses the top 10 recommended models. It is used once its key is set. Now:\n${list("openrouter", OR, 10)}`,
    isError: false,
  });
  assert.deepEqual(saved(m.dataDir).models, { nvidia: 3, openrouter: 10 });
});

test("models: a size outside 3, 5 and 10 saves nothing", async () => {
  for (const size of [4, "3", "x"]) {
    const m = models({ args: { nvidia: size } });
    assert.deepEqual(await m.run(), { text: "nvidia must be 3, 5, 10.", isError: true }, String(size));
    assert.equal(saved(m.dataDir), undefined);
  }
});

test("models: a broken settings file is not replaced", async () => {
  const m = models({ args: { nvidia: 3 } });
  writeFileSync(settingsPath(m.dataDir), "{ broken");
  const r = await m.run();
  assert.equal(r.isError, true);
  assert.equal(readFileSync(settingsPath(m.dataDir), "utf8"), "{ broken");
});
