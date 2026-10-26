// Manual smoke test against the real APIs: NVIDIA_API_KEY=... and/or OPENROUTER_API_KEY=... npm run smoke
import { createApp } from "../src/app.ts";
import { ask } from "../src/ask.ts";
import type { CallOptions } from "../src/providers/types.ts";

const warn = (msg: string) => console.error(`[smoke] ${msg}`);
const { askDeps } = createApp(process.env, warn);
if (askDeps.active.length === 0) {
  console.error("Set NVIDIA_API_KEY and/or OPENROUTER_API_KEY to run the smoke test.");
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

// Logs each attempt with its latency, so slow default models show up.
const call = async (o: CallOptions) => {
  const start = Date.now();
  const r = await askDeps.call(o);
  console.error(`[smoke] ${o.provider} ${o.model}: ${r.ok ? "ok" : r.message} (${((Date.now() - start) / 1000).toFixed(1)} s)`);
  return r;
};
const result = await ask({ prompt, preset: "review" }, { ...askDeps, call });
console.log(result.text);
if (result.isError) process.exit(1);
