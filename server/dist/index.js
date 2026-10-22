#!/usr/bin/env node
import { ask, toolDefinition } from "./ask.js";
import { loadConfig } from "./config.js";
import { createModelSource } from "./models.js";
import { createCaller } from "./openrouter.js";
import { BUILTIN_PRESETS_DIR, loadPresets } from "./presets.js";
import { createHandler, serveStdio } from "./protocol.js";
import { VERSION } from "./version.js";
// stdout carries JSON-RPC only; every log line goes to stderr.
const warn = (msg) => {
    process.stderr.write(`[free-to-review] ${msg}\n`);
};
const config = loadConfig(process.env, warn);
const presets = loadPresets([BUILTIN_PRESETS_DIR], warn);
const models = createModelSource({ fetch, now: Date.now, timeoutMs: config.timeoutMs });
const call = createCaller({ fetch, apiKey: config.apiKey ?? "", timeoutMs: config.timeoutMs });
const blocked = new Map();
const handler = createHandler({
    name: "free-to-review",
    version: VERSION,
    tools: [toolDefinition(presets)],
    callTool: (_name, args) => ask(args, { config, presets, getFreeModels: models.getFreeModels, call, now: Date.now, blocked }),
});
await serveStdio(handler, process.stdin, process.stdout);
