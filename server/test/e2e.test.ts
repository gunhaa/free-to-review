import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.ts";
import { TIP_MODELS } from "../src/ask.ts";
import { NO_KEY, noKeyMessage } from "../src/config.ts";
import { createSession, serveStdio } from "../src/protocol.ts";
import { VERSION } from "../src/version.ts";

const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));
const ROOT_DIR = fileURLToPath(new URL("../..", import.meta.url));

function runServer(messages: object[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: SERVER_DIR,
      env: { PATH: process.env.PATH, HOME: mkdtempSync(`${tmpdir()}/f2r-home-`) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", c => { stdout += String(c); });
    child.stderr.on("data", c => { stderr += String(c); });
    child.on("error", reject);
    child.on("close", code => resolve({ stdout, stderr, code }));
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
  });
}

test("stdio session without an API key", async () => {
  const { stdout, code } = await runServer([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ask", arguments: { prompt: "x" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "models", arguments: {} } },
  ]);
  assert.equal(code, 0);
  const lines = stdout.split("\n").filter(l => l.length > 0);
  const replies = lines.map(l => JSON.parse(l));
  assert.equal(replies.length, 4);
  const byId = new Map(replies.map(r => [r.id, r]));
  assert.equal(byId.get(1).result.serverInfo.name, "free-to-review");
  assert.equal(byId.get(1).result.serverInfo.version, VERSION);
  const tools = byId.get(2).result.tools;
  assert.deepEqual(tools.map((t: { name: string }) => t.name), ["ask", "models", "provider"]);
  assert.deepEqual(tools[0].inputSchema.properties.preset.enum, ["review"]);
  assert.equal(byId.get(3).result.isError, true);
  assert.equal(byId.get(3).result.content[0].text, NO_KEY);
  assert.equal(byId.get(4).result.content[0].text, NO_KEY);
});

test("dist/index.js is executable with a node shebang", () => {
  assert.ok(readFileSync(`${SERVER_DIR}dist/index.js`, "utf8").startsWith("#!/usr/bin/env node\n"));
});

test("version strings agree", () => {
  const pkg = JSON.parse(readFileSync(`${SERVER_DIR}package.json`, "utf8"));
  assert.equal(pkg.version, VERSION);
  assert.equal(JSON.parse(readFileSync(`${ROOT_DIR}.claude-plugin/plugin.json`, "utf8")).version, VERSION);
});

test("provider tool: elicitation round trip over the wire", async () => {
  // In-process with a fake fetch, so the test never reaches the real model lists.
  const offline = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  const { spec } = createApp({ NVIDIA_API_KEY: "n", F2R_DATA_DIR: mkdtempSync(`${tmpdir()}/f2r-data-`) }, () => {}, { fetch: offline });
  const input = new PassThrough();
  const output = new PassThrough();
  let buf = "";
  output.on("data", c => { buf += String(c); });
  const lines = () => buf.split("\n").filter(l => l.length > 0).map(l => JSON.parse(l));
  const done = serveStdio(send => createSession(spec, send), input, output);
  const write = (m: object) => input.write(`${JSON.stringify(m)}\n`);
  write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "t", version: "0" } } });
  write({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "provider", arguments: {} } });
  for (let i = 0; i < 100 && !lines().some(m => m.id === "s-1"); i++) await new Promise(r => setTimeout(r, 10));
  const elicit = lines().find(m => m.id === "s-1");
  assert.equal(elicit.method, "elicitation/create");
  assert.equal(elicit.params.requestedSchema.properties.preferred.title, "Provider");
  write({ jsonrpc: "2.0", id: "s-1", result: { action: "cancel" } });
  input.end();
  await done;
  assert.deepEqual(lines().find(m => m.id === 2).result, { content: [{ type: "text", text: "No changes." }], isError: false });
});

test("first run uses defaults, then reuses the sticky model", async () => {
  const nvidiaList = JSON.parse(readFileSync(new URL("./fixtures/nvidia-models.json", import.meta.url), "utf8"));
  const sent: string[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/models")) return Response.json(nvidiaList);
    sent.push(JSON.parse(String(init?.body)).model);
    const sse = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const dataDir = mkdtempSync(`${tmpdir()}/f2r-data-`);
  const { spec } = createApp({ NVIDIA_API_KEY: "k", F2R_DATA_DIR: dataDir }, () => {}, { fetch: fakeFetch });
  const ctx = { clientCapabilities: {}, request: async () => ({}) };
  const first = await spec.callTool("ask", { prompt: "p" }, ctx);
  assert.equal(first.isError, false);
  assert.ok(first.text.endsWith(TIP_MODELS));
  const state = JSON.parse(readFileSync(join(dataDir, "state.json"), "utf8"));
  assert.equal(state.sticky.model, sent[0]);
  assert.equal(state.sticky.provider, "nvidia");
  // Across many runs a random pick would differ at least once; the sticky model never does.
  for (let i = 0; i < 5; i++) await spec.callTool("ask", { prompt: "p" }, ctx);
  assert.deepEqual(new Set(sent), new Set([sent[0]]));
  assert.equal(sent.length, 6);
});

test("a key with an unknown non-ASCII character is reported by every tool, not as a missing key", async () => {
  const warns: string[] = [];
  const { spec } = createApp({ NVIDIA_API_KEY: "nvapi-a\u00e9b", F2R_DATA_DIR: mkdtempSync(`${tmpdir()}/f2r-data-`) }, m => warns.push(m));
  const ctx = { clientCapabilities: { elicitation: {} }, request: async () => ({ action: "cancel" }) };
  for (const [name, args] of [["provider", {}], ["models", {}], ["ask", { prompt: "p" }]] as const) {
    assert.deepEqual(await spec.callTool(name, args, ctx), { text: noKeyMessage(["nvidia"]), isError: true }, name);
  }
  assert.equal(warns.length, 1);
});

test("a key with an auto-corrected dash is sent with two hyphens", async () => {
  let auth: string | null = null;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/models")) return Response.json(JSON.parse(readFileSync(new URL("./fixtures/nvidia-models.json", import.meta.url), "utf8")));
    auth = new Headers(init?.headers).get("authorization");
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const { spec } = createApp({ NVIDIA_API_KEY: "nvapi\u2014b", F2R_DATA_DIR: mkdtempSync(`${tmpdir()}/f2r-data-`) }, () => {}, { fetch: fakeFetch });
  const r = await spec.callTool("ask", { prompt: "p" }, { clientCapabilities: {}, request: async () => ({}) });
  assert.equal(r.isError, false);
  assert.equal(auth, "Bearer nvapi--b");
});
