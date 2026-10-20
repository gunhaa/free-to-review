// Manual smoke test against the real OpenRouter API: OPENROUTER_API_KEY=... npm run smoke
import { homedir } from "node:os";
import { ask } from "../src/ask.ts";
import { loadConfig } from "../src/config.ts";
import { createModelSource } from "../src/models.ts";
import { createCaller } from "../src/openrouter.ts";
import { BUILTIN_PRESETS_DIR, loadPresets } from "../src/presets.ts";

const warn = (msg: string) => console.error(`[smoke] ${msg}`);
const config = loadConfig(process.env, homedir(), warn);
if (!config.apiKey) {
  console.error("Set OPENROUTER_API_KEY to run the smoke test.");
  process.exit(1);
}

const prompt = `Language: JavaScript. Purpose: return the sum of all numbers in an array.

function sumAll(numbers) {
  let total = 0;
  for (let i = 0; i <= numbers.length; i++) {
    total += numbers[i];
  }
  return total;
}

console.log(sumAll([1, 2, 3]));
module.exports = { sumAll };`;

const models = createModelSource({ fetch, now: Date.now, timeoutMs: config.timeoutMs });
const result = await ask(
  { prompt, preset: "review" },
  {
    config,
    presets: loadPresets([BUILTIN_PRESETS_DIR, config.presetsDir], warn),
    getFreeModels: models.getFreeModels,
    call: createCaller({ fetch, apiKey: config.apiKey, timeoutMs: config.timeoutMs }),
    now: Date.now,
  },
);
console.log(result.text);
if (result.isError) process.exit(1);
