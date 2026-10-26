#!/usr/bin/env node
import { createApp } from "./app.js";
import { createSession, serveStdio } from "./protocol.js";
// stdout carries JSON-RPC only; every log line goes to stderr.
const warn = (msg) => {
    process.stderr.write(`[free-to-review] ${msg}\n`);
};
const { spec } = createApp(process.env, warn);
await serveStdio(send => createSession(spec, send), process.stdin, process.stdout);
