import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createSession, serveStdio } from "../src/protocol.ts";
import type { ServerSpec, ToolContext } from "../src/protocol.ts";

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
const h = (m: unknown, s = spec()): Promise<Reply> => createSession(s, () => {}).handle(m);
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
  const done = serveStdio(send => createSession(spec(), send), input, output);
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
  const done = serveStdio(send => createSession(slow, send), input, output);
  input.write(JSON.stringify(req(1, "tools/call", { name: "ask", arguments: { prompt: "slow" } })) + "\n");
  input.write(JSON.stringify(req(2, "tools/call", { name: "ask", arguments: { prompt: "fast" } })) + "\n");
  input.end();
  await done;
  assert.deepEqual(lines().map(m => m.id), [2, 1]);
});

// A session whose tool hands its context to the test, plus everything the session sent.
function contextSession() {
  const sent: Reply[] = [];
  let ctx: ToolContext | undefined;
  const session = createSession(spec(async (_n, _a, c) => { ctx = c; return { text: "t", isError: false }; }), m => sent.push(m));
  const context = async (): Promise<ToolContext> => {
    await session.handle(req(99, "tools/call", { name: "ask", arguments: {} }));
    return ctx!;
  };
  return { session, sent, context };
}

test("records client capabilities from initialize", async () => {
  const { session, context } = contextSession();
  assert.deepEqual((await context()).clientCapabilities, {});
  await session.handle(req(1, "initialize", { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } }));
  assert.deepEqual((await context()).clientCapabilities, { elicitation: {} });
});

test("request sends s-1 and resolves on the matching response", async () => {
  const { session, sent, context } = contextSession();
  const ctx = await context();
  const p = ctx.request("elicitation/create", { message: "m" }, 1000);
  assert.deepEqual(sent, [{ jsonrpc: "2.0", id: "s-1", method: "elicitation/create", params: { message: "m" } }]);
  assert.equal(await session.handle({ jsonrpc: "2.0", id: "s-1", result: { action: "accept" } }), null);
  assert.deepEqual(await p, { action: "accept" });
});

test("responses out of order resolve the right requests", async () => {
  const { session, sent, context } = contextSession();
  const ctx = await context();
  const first = ctx.request("a", {}, 1000);
  const second = ctx.request("b", {}, 1000);
  assert.deepEqual(sent.map(m => m.id), ["s-1", "s-2"]);
  await session.handle({ jsonrpc: "2.0", id: "s-2", result: { n: 2 } });
  await session.handle({ jsonrpc: "2.0", id: "s-1", result: { n: 1 } });
  assert.deepEqual(await first, { n: 1 });
  assert.deepEqual(await second, { n: 2 });
});

test("a client response with a client-style id does not resolve a server request", async () => {
  const { session, context } = contextSession();
  const ctx = await context();
  const p = ctx.request("a", {}, 20);
  assert.equal(await session.handle({ jsonrpc: "2.0", id: 1, result: {} }), null);
  await assert.rejects(p, /^Error: timeout$/);
});

test("error response rejects with its message", async () => {
  const { session, context } = contextSession();
  const p = (await context()).request("a", {}, 1000);
  await session.handle({ jsonrpc: "2.0", id: "s-1", error: { code: -32601, message: "Method not found" } });
  await assert.rejects(p, /Method not found/);
});

test("request times out and later response is ignored", async () => {
  const { session, context } = contextSession();
  const p = (await context()).request("a", {}, 10);
  await assert.rejects(p, /^Error: timeout$/);
  assert.equal(await session.handle({ jsonrpc: "2.0", id: "s-1", result: {} }), null);
});

test("close rejects pending requests and later requests", async () => {
  const { session, context } = contextSession();
  const ctx = await context();
  const p = ctx.request("a", {}, 1000);
  session.close();
  await assert.rejects(p, /connection closed/);
  await assert.rejects(ctx.request("b", {}, 1000), /connection closed/);
});

test("serveStdio: a tool can elicit while the client keeps talking", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = collect(output);
  const eliciting = spec(async (_n, _a, ctx) => {
    const r = (await ctx.request("elicitation/create", { message: "pick" }, 1000)) as { action: string };
    return { text: r.action, isError: false };
  });
  const done = serveStdio(send => createSession(eliciting, send), input, output);
  input.write(JSON.stringify(req(1, "tools/call", { name: "ask", arguments: {} })) + "\n");
  await new Promise(r => setTimeout(r, 10));
  const ask = lines().find(m => m.id === "s-1");
  assert.equal(ask.method, "elicitation/create");
  input.write(JSON.stringify(req(2, "ping")) + "\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: "s-1", result: { action: "cancel" } }) + "\n");
  input.end();
  await done;
  const out = lines();
  assert.deepEqual(out.find(m => m.id === 2).result, {});
  assert.deepEqual(out.find(m => m.id === 1).result, { content: [{ type: "text", text: "cancel" }], isError: false });
});

test("serveStdio: closing input ends a tool waiting on the client", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = collect(output);
  const waiting = spec(async (_n, _a, ctx) => {
    try {
      await ctx.request("elicitation/create", {}, 60_000);
      return { text: "answered", isError: false };
    } catch (err) {
      return { text: String(err), isError: true };
    }
  });
  const done = serveStdio(send => createSession(waiting, send), input, output);
  input.write(JSON.stringify(req(1, "tools/call", { name: "ask", arguments: {} })) + "\n");
  await new Promise(r => setTimeout(r, 10));
  input.end();
  await done;
  assert.match(lines().find(m => m.id === 1).result.content[0].text, /connection closed/);
});
