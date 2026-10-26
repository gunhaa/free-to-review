import { DEFAULT_PRIORITY, recommend } from "./catalog.js";
import { PROVIDER_NAMES, RECOMMENDED_PROVIDER } from "./providers/types.js";
import { loadSettings } from "./settings.js";
import { blockKey } from "./state.js";
export async function fetchLive(providers) {
    const entries = await Promise.all([...providers].map(async ([id, p]) => {
        try {
            return [id, await p.listModels()];
        }
        catch {
            return [id, undefined];
        }
    }));
    return new Map(entries);
}
export const MAX_PER_PROVIDER = 3;
export const DEFAULT_SET_SIZE = 5;
// A preferred provider without a key is ignored, as if none were set.
export function resolvePreferred(active, preferred) {
    if (preferred !== undefined && active.includes(preferred))
        return { provider: preferred, inferred: false };
    if (active.length === 0)
        return undefined;
    if (active.length === 1)
        return { provider: active[0], inferred: false };
    return { provider: RECOMMENDED_PROVIDER, inferred: true };
}
// The first `size` recommendations; without a live list, the built-in order, unverified.
// It is worked out on every request, so it follows models the provider adds or drops.
export function topSet(provider, live, size) {
    return (live ? recommend(provider, live) : DEFAULT_PRIORITY[provider]).slice(0, size);
}
function shuffle(items, random) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
export function planAttempts(input) {
    const { state, now } = input;
    const skipped = [];
    if (input.preferred !== undefined && !input.active.includes(input.preferred)) {
        skipped.push(`preferred: no key for ${PROVIDER_NAMES[input.preferred]}`);
    }
    const resolved = resolvePreferred(input.active, input.preferred);
    if (!resolved)
        return { order: [], attempts: [], usedDefaults: {}, preferredInferred: false, skipped };
    const order = [resolved.provider, ...input.active.filter(p => p !== resolved.provider)];
    const usedDefaults = {};
    const blocked = (p, m) => (state.blockedModels.get(blockKey(p, m)) ?? 0) > now;
    const providerBlocked = (p) => (state.blockedProviders.get(p) ?? 0) > now;
    const sets = new Map();
    for (const p of order) {
        const top = input.top[p];
        usedDefaults[p] = top === undefined;
        const set = topSet(p, input.live.get(p), top ?? DEFAULT_SET_SIZE);
        const open = set.filter(m => !blocked(p, m));
        // When every model is blocked, trying them beats giving up.
        sets.set(p, open.length > 0 ? open : set);
    }
    const st = state.sticky;
    const sticky = st && st.until > now && order.includes(st.provider) && !providerBlocked(st.provider) && sets.get(st.provider)?.includes(st.model) && !blocked(st.provider, st.model) ? st : undefined;
    const attempts = sticky ? [{ provider: sticky.provider, model: sticky.model }] : [];
    for (const p of order) {
        if (providerBlocked(p))
            continue;
        const isSticky = sticky?.provider === p;
        const group = shuffle((sets.get(p) ?? []).filter(m => !(isSticky && m === sticky.model)), input.random);
        for (const model of group.slice(0, isSticky ? MAX_PER_PROVIDER - 1 : MAX_PER_PROVIDER))
            attempts.push({ provider: p, model });
    }
    return { order, attempts, usedDefaults, preferredInferred: resolved.inferred, skipped };
}
// Reads settings.json on every plan, so edits apply without a restart. Each distinct
// problem report is written to stderr only once per process.
export function createAttemptPlanner(deps) {
    const warned = new Set();
    return async (state, now) => {
        const settings = loadSettings(deps.dataDir);
        const live = await fetchLive(deps.providers);
        const plan = planAttempts({ active: [...deps.providers.keys()], preferred: settings.preferred, top: settings.models, live, state, now, random: deps.random });
        const lines = [...settings.problems, ...plan.skipped];
        if (lines.length > 0) {
            const message = `settings.json: skipping ${lines.join("; ")}`;
            if (!warned.has(message)) {
                warned.add(message);
                deps.warn(message);
            }
        }
        return plan;
    };
}
