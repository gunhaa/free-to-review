import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createHandler, serveStdio } from "../src/protocol.ts";
import type { ServerSpec } from "../src/protocol.ts";

const TOOL = { name: "ask", description: "d", inputSchema: { type: "object" } };

function spec(callTool?: ServerSpec["callTool"]): ServerSpec {
  return {
    name: "free-to-review",
    version: "0.1.0",
    tools: [TOOL],
    callTool: callTool ?? (async (_name, args) => ({ text: `echo:${String(args.prompt)}`, isError: args.prompt === "bad" })),
  };
}

type Reply = any;
const h = (m: unknown, s = spec()): Promise<Reply> => createHandler(s)(m);
const req = (id: number, method: string, params?: object) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

test("initialize echoes supported version, else newest", async () => {
  const r = await h(req(1, "initialize", { protocolVersion: "2025-03-26" }));
  assert.equal(r.jsonrpc, "2.0");
  assert.equal(r.id, 1);
  assert.deepEqual(r.result, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "free-to-review", version: "0.1.0" } });
  assert.equal((await h(req(2, "initialize", { protocolVersion: "1999-01-01" }))).result.protocolVersion, "2025-06-18");
  assert.equal((await h(req(3, "initialize"))).result.protocolVersion, "2025-06-18");
});

test("notifications get no reply", async () => {
  assert.equal(await h({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await h({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} }), null);
});

test("ping, tools/list, unknown method", async () => {
  assert.deepEqual((await h(req(1, "ping"))).result, {});
  assert.deepEqual((await h(req(2, "tools/list"))).result, { tools: [TOOL] });
  const r = await h(req(3, "nope"));
  assert.equal(r.id, 3);
  assert.equal(r.error.code, -32601);
});

test("tools/call maps ToolResult and isError", async () => {
  const r = await h(req(3, "tools/call", { name: "ask", arguments: { prompt: "x" } }));
  assert.deepEqual(r.result, { content: [{ type: "text", text: "echo:x" }], isError: false });
  const bad = await h(req(4, "tools/call", { name: "ask", arguments: { prompt: "bad" } }));
  assert.equal(bad.result.isError, true);
});

test("tools/call without arguments passes an empty object", async () => {
  let seen: unknown;
  const r = await h(req(5, "tools/call", { name: "ask" }), spec(async (_n, args) => { seen = args; return { text: "t", isError: false }; }));
  assert.deepEqual(seen, {});
  assert.equal(r.result.isError, false);
});

test("tools/call invalid params", async () => {
  assert.equal((await h(req(1, "tools/call", { name: "other", arguments: {} }))).error.code, -32602);
  assert.equal((await h(req(2, "tools/call", { name: "ask", arguments: "str" }))).error.code, -32602);
  assert.equal((await h(req(3, "tools/call", { name: "ask", arguments: [] }))).error.code, -32602);
  assert.equal((await h(req(4, "tools/call"))).error.code, -32602);
});

test("tool that throws becomes an isError result", async () => {
  const r = await h(req(1, "tools/call", { name: "ask", arguments: {} }), spec(async () => { throw new Error("kaput"); }));
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /kaput/);
});

test("invalid request shape is -32600", async () => {
  assert.equal((await h({ jsonrpc: "2.0", id: 1 })).error.code, -32600);
  assert.equal((await h(42)).error.code, -32600);
});

function collect(output: PassThrough): () => Reply[] {
  let buf = "";
  output.on("data", c => { buf += String(c); });
  return () => buf.split("\n").filter(l => l.length > 0).map(l => JSON.parse(l));
}

test("serveStdio: split chunks, two messages per chunk, parse error", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = collect(output);
  const done = serveStdio(createHandler(spec()), input, output);
  input.write('{"jsonrpc":"2.0","id":1,"method":"pi');
  input.write('ng"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n\nnot json\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  input.end();
  await done;
  const out = lines();
  assert.equal(out.length, 3);
  assert.deepEqual(out.filter(m => m.result).map(m => m.id).sort(), [1, 2]);
  const parseError = out.find(m => m.error);
  assert.equal(parseError.id, null);
  assert.equal(parseError.error.code, -32700);
});

test("serveStdio handles requests concurrently", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = collect(output);
  const slow = spec(async (_n, args) => {
    if (args.prompt === "slow") await new Promise(r => setTimeout(r, 50));
    return { text: String(args.prompt), isError: false };
  });
  const done = serveStdio(createHandler(slow), input, output);
  input.write(JSON.stringify(req(1, "tools/call", { name: "ask", arguments: { prompt: "slow" } })) + "\n");
  input.write(JSON.stringify(req(2, "tools/call", { name: "ask", arguments: { prompt: "fast" } })) + "\n");
  input.end();
  await done;
  assert.deepEqual(lines().map(m => m.id), [2, 1]);
});
