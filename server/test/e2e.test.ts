import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
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
  ]);
  assert.equal(code, 0);
  const lines = stdout.split("\n").filter(l => l.length > 0);
  const replies = lines.map(l => JSON.parse(l));
  assert.equal(replies.length, 3);
  const byId = new Map(replies.map(r => [r.id, r]));
  assert.equal(byId.get(1).result.serverInfo.name, "free-to-review");
  assert.equal(byId.get(1).result.serverInfo.version, "0.1.0");
  const tools = byId.get(2).result.tools;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "ask");
  assert.deepEqual(tools[0].inputSchema.properties.preset.enum, ["critique", "edge-cases", "review"]);
  assert.equal(byId.get(3).result.isError, true);
  assert.match(byId.get(3).result.content[0].text, /OPENROUTER_API_KEY/);
});

test("dist/index.js is executable with a node shebang", () => {
  assert.ok(readFileSync(`${SERVER_DIR}dist/index.js`, "utf8").startsWith("#!/usr/bin/env node\n"));
});

test("version strings agree", t => {
  const pkg = JSON.parse(readFileSync(`${SERVER_DIR}package.json`, "utf8"));
  assert.equal(pkg.version, VERSION);
  const manifest = `${ROOT_DIR}.claude-plugin/plugin.json`;
  if (!existsSync(manifest)) {
    t.skip("plugin.json is created in Task 8");
    return;
  }
  assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, VERSION);
});
