import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSseLines, readChatStream } from "../../src/providers/sse.ts";

function stream(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const x of chunks) c.enqueue(typeof x === "string" ? enc.encode(x) : x);
      c.close();
    },
  });
}

const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const delta = (d: Record<string, unknown>, finish: string | null = null) => ev({ choices: [{ delta: d, finish_reason: finish }] });

function read(body: ReadableStream<Uint8Array>) {
  let first = 0;
  return readChatStream(body, () => first++).then((outcome) => ({ outcome, first }));
}

test("parseSseLines returns complete data lines and the rest", () => {
  assert.deepEqual(parseSseLines("data: a\n\ndata: b\nda"), { events: ["a", "b"], rest: "da" });
});

test("parseSseLines handles CRLF", () => {
  assert.deepEqual(parseSseLines("data: a\r\n\r\n").events, ["a"]);
});

test("parseSseLines ignores comments and other fields", () => {
  assert.deepEqual(parseSseLines(": OPENROUTER PROCESSING\nevent: x\nid: 1\ndata: a\n").events, ["a"]);
});

test("parseSseLines strips only one leading space", () => {
  assert.deepEqual(parseSseLines("data:a\n").events, ["a"]);
  assert.deepEqual(parseSseLines("data:  a\n").events, [" a"]);
});

test("joins content deltas and ignores reasoning", async () => {
  const r = await read(
    stream(delta({ reasoning_content: "think" }), delta({ reasoning_content: "more" }), delta({ content: "Hel" }), delta({ content: "lo" }), delta({}, "stop"), "data: [DONE]\n\n"),
  );
  assert.deepEqual(r.outcome, { kind: "done", text: "Hello" });
  assert.equal(r.first, 1);
});

test("splits a multibyte character across chunks", async () => {
  const bytes = new TextEncoder().encode(delta({ content: "리뷰" }, "stop"));
  const cut = bytes.indexOf(0xeb) + 1; // inside the first character
  const r = await read(stream(bytes.slice(0, cut), bytes.slice(cut), "data: [DONE]\n\n"));
  assert.deepEqual(r.outcome, { kind: "done", text: "리뷰" });
});

test("splits a line across chunks", async () => {
  const r = await read(stream('data: {"choices":[{"del', 'ta":{"content":"x"}}]}\n\ndata: [DONE]\n\n'));
  assert.deepEqual(r.outcome, { kind: "done", text: "x" });
});

test("finish_reason then end of stream is done", async () => {
  const r = await read(stream(delta({ content: "x" }), delta({}, "stop")));
  assert.deepEqual(r.outcome, { kind: "done", text: "x" });
});

test("ends early without finish_reason", async () => {
  const r = await read(stream(delta({ content: "x" })));
  assert.deepEqual(r.outcome, { kind: "truncated" });
});

test("error event", async () => {
  const r = await read(stream(ev({ error: { message: "overloaded" } })));
  assert.deepEqual(r.outcome, { kind: "error", message: "overloaded" });
});

test("non-JSON event is skipped", async () => {
  const r = await read(stream("data: garbage\n\n", delta({ content: "x" }, "stop"), "data: [DONE]\n\n"));
  assert.deepEqual(r.outcome, { kind: "done", text: "x" });
});

test("no events at all", async () => {
  const r = await read(stream());
  assert.deepEqual(r.outcome, { kind: "truncated" });
  assert.equal(r.first, 0);
});
