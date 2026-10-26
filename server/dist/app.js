import { ask, toolDefinition } from "./ask.js";
import { createAttemptPlanner, fetchLive, resolvePreferred } from "./candidates.js";
import { loadConfig } from "./config.js";
import { configureModels, configureProvider, modelsToolDefinition, providerToolDefinition } from "./configure.js";
import { BUILTIN_PRESETS_DIR, loadPresets } from "./presets.js";
import { createNvidia } from "./providers/nvidia.js";
import { createOpenRouter } from "./providers/openrouter.js";
import { createRouter } from "./providers/router.js";
import { loadSettings } from "./settings.js";
import { createStateStore } from "./state.js";
import { VERSION } from "./version.js";
// A model list that does not answer quickly is skipped in favour of the built-in order.
const LIST_TIMEOUT_MS = 15_000;
export function createApp(env, warn, deps = {}) {
    const f = deps.fetch ?? fetch;
    const now = deps.now ?? Date.now;
    const config = loadConfig(env, warn, deps.home);
    const presets = loadPresets(BUILTIN_PRESETS_DIR, warn);
    // Only providers with a key exist, so nothing is ever sent without one.
    const providers = new Map();
    if (config.keys.nvidia)
        providers.set("nvidia", createNvidia({ fetch: f, now, apiKey: config.keys.nvidia, listTimeoutMs: LIST_TIMEOUT_MS, firstByteMs: config.firstByteMs }));
    if (config.keys.openrouter)
        providers.set("openrouter", createOpenRouter({ fetch: f, now, apiKey: config.keys.openrouter, listTimeoutMs: LIST_TIMEOUT_MS }));
    const active = [...providers.keys()];
    const state = createStateStore(config.dataDir, warn, now);
    const askDeps = {
        config,
        presets,
        active,
        preferred: () => resolvePreferred(active, loadSettings(config.dataDir).preferred)?.provider,
        plan: createAttemptPlanner({ providers, dataDir: config.dataDir, random: Math.random, warn }),
        call: createRouter(providers),
        now,
        state,
        tips: { provider: false, models: false },
    };
    const spec = {
        name: "free-to-review",
        version: VERSION,
        tools: [toolDefinition(presets), modelsToolDefinition, providerToolDefinition],
        callTool: (name, args, ctx) => {
            switch (name) {
                case "models":
                    return configureModels({ active, rejected: config.rejectedKeys, live: () => fetchLive(providers), dataDir: config.dataDir, args });
                case "provider":
                    return configureProvider({ active, rejected: config.rejectedKeys, dataDir: config.dataDir, state, now, ctx });
                default:
                    return ask(args, askDeps);
            }
        },
    };
    return { spec, askDeps };
}
