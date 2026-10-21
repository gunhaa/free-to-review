#!/usr/bin/env node
import { homedir } from "node:os";
import { ask, toolDefinition } from "./ask.ts";
import { loadConfig } from "./config.ts";
import { createModelSource } from "./models.ts";
import { createCaller } from "./openrouter.ts";
import { BUILTIN_PRESETS_DIR, loadPresets } from "./presets.ts";
import { createHandler, serveStdio } from "./protocol.ts";
import { VERSION } from "./version.ts";

// stdout carries JSON-RPC only; every log line goes to stderr.
const warn = (msg: string) => {
  process.stderr.write(`[free-to-review] ${msg}\n`);
};

const config = loadConfig(process.env, homedir(), warn);
const presets = loadPresets([BUILTIN_PRESETS_DIR, config.presetsDir], warn);
const models = createModelSource({ fetch, now: Date.now, timeoutMs: config.timeoutMs });
const call = createCaller({ fetch, apiKey: config.apiKey ?? "", timeoutMs: config.timeoutMs });

const blocked = new Map<string, number>();

const handler = createHandler({
  name: "free-to-review",
  version: VERSION,
  tools: [toolDefinition(presets)],
  callTool: (_name, args) => ask(args, { config, presets, getFreeModels: models.getFreeModels, call, now: Date.now, blocked }),
});

await serveStdio(handler, process.stdin, process.stdout);
