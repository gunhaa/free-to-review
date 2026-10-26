// The recommended default set comes from the front of this list (those the provider still
// lists), and the models dialog offers them first. Updated with each release
// (from the live lists of 2026-10-22). thinkingmachines/inkling* is left out: it answers 403
// outside listed agentic harnesses. The NVIDIA order follows the 2026-10-22 smoke run: models
// that answered come first; gemma-4-31b-it often sat in NVIDIA's queue past the timeout, and
// kimi-k2.6 and nemotron-3-super answered 404 for a trial key. z-ai/glm-5.3 is left out:
// NVIDIA marks it deprecated from 2026-10-28.
export const DEFAULT_PRIORITY = {
    nvidia: [
        "deepseek-ai/deepseek-v4.1-flash",
        "z-ai/glm-5.3-flash",
        "openai/gpt-oss-20b",
        "google/gemma-4-31b-it",
        "moonshotai/kimi-k2.6",
        "nvidia/nemotron-3-super-120b-a12b",
    ],
    openrouter: [
        "minimax/minimax-m3.1-flash:free",
        "google/gemma-4-31b-it:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "poolside/laguna-s-2.1:free",
        "google/gemma-4-26b-a4b-it:free",
    ],
};
// The same vendor is spelled differently on NVIDIA and OpenRouter. Only used to match BRANDS.
const VENDOR_ALIASES = {
    "deepseek-ai": "deepseek",
    "meta-llama": "meta",
    "nv-mistralai": "mistralai",
    "qwen-ai": "qwen",
    alibaba: "qwen",
};
export function vendorOf(id) {
    const slash = id.indexOf("/");
    const vendor = slash === -1 ? id : id.slice(0, slash);
    return VENDOR_ALIASES[vendor] ?? vendor;
}
// Normalized vendors (see vendorOf) whose general chat models are worth trying after the defaults.
export const BRANDS = ["deepseek", "moonshotai", "z-ai", "qwen", "google", "meta", "mistralai", "openai", "nvidia", "minimax", "microsoft"];
// Models that are not general chat models: embeddings, guards, vision, parsers, and so on.
export const EXCLUDE = /embed|guard|safety|vision|vlm|-vl|parse|reward|clip|translate|deplot|kosmos|fuyu|neva|vila|detector|calibration|retriever|omni|cosmos|diffusion|chatqa|palmyra/;
// Parameter count in billions from the model name: "8x22b" → 176, else the largest "<n>b"
// (so a MoE's active size like "a55b" loses to its total). "800m" and "128k" are ignored.
export function sizeOf(id) {
    const name = id.slice(id.indexOf("/") + 1).toLowerCase();
    const moe = /(\d+)x(\d+(?:\.\d+)?)b/.exec(name);
    if (moe)
        return Number(moe[1]) * Number(moe[2]);
    const sizes = [...name.matchAll(/(?<![a-z])(\d+(?:\.\d+)?)b(?![a-z0-9])/g)].map(m => Number(m[1]));
    return sizes.length > 0 ? Math.max(...sizes) : undefined;
}
function bySizeThenId(a, b) {
    const sa = sizeOf(a);
    const sb = sizeOf(b);
    if (sa !== sb) {
        if (sa === undefined)
            return 1;
        if (sb === undefined)
            return -1;
        return sb - sa;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}
// Raw (unprefixed) IDs in recommended order: the built-in priority that is still live, then
// the other brand chat models (NVIDIA by size, OpenRouter in its list order).
export function recommend(provider, live) {
    const liveSet = new Set(live);
    const builtIn = DEFAULT_PRIORITY[provider].filter(id => liveSet.has(id));
    const taken = new Set(builtIn);
    const rest = [...new Set(live)].filter(id => !taken.has(id) && !EXCLUDE.test(id.toLowerCase()) && BRANDS.includes(vendorOf(id)));
    if (provider === "nvidia")
        rest.sort(bySizeThenId);
    return [...builtIn, ...rest];
}
