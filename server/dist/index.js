#!/usr/bin/env node
import { homedir } from "node:os";
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
const config = loadConfig(process.env, homedir(), warn);
const presets = loadPresets([BUILTIN_PRESETS_DIR, config.presetsDir], warn);
const models = createModelSource({ fetch, now: Date.now, timeoutMs: config.timeoutMs });
const call = createCaller({ fetch, apiKey: config.apiKey ?? "", timeoutMs: config.timeoutMs });
const handler = createHandler({
    name: "free-to-review",
    version: VERSION,
    tools: [toolDefinition(presets)],
    callTool: (_name, args) => ask(args, { config, presets, getFreeModels: models.getFreeModels, call, now: Date.now }),
});
await serveStdio(handler, process.stdin, process.stdout);
