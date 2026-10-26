import { DEFAULT_PRIORITY, recommend } from "./catalog.ts";
import { PROVIDER_NAMES, RECOMMENDED_PROVIDER } from "./providers/types.ts";
import { loadSettings } from "./settings.ts";
import type { TopSize } from "./settings.ts";
import { blockKey } from "./state.ts";
import type { State } from "./state.ts";
import type { Provider, ProviderId } from "./providers/types.ts";

export async function fetchLive(providers: Map<ProviderId, Provider>): Promise<Map<ProviderId, string[] | undefined>> {
  const entries = await Promise.all(
    [...providers].map(async ([id, p]): Promise<[ProviderId, string[] | undefined]> => {
      try {
        return [id, await p.listModels()];
      } catch {
        return [id, undefined];
      }
    }),
  );
  return new Map(entries);
}

export const MAX_PER_PROVIDER = 3;
export const DEFAULT_SET_SIZE = 5;

export type Attempt = { provider: ProviderId; model: string };

export interface PlanInput {
  active: ProviderId[];
  preferred?: ProviderId;
  top: Partial<Record<ProviderId, TopSize>>;
  live: Map<ProviderId, string[] | undefined>;
  state: State;
  now: number;
  random: () => number;
}

export interface AttemptPlan {
  // Preferred provider first; failure messages follow this order.
  order: ProviderId[];
  attempts: Attempt[];
  // No size was chosen for this provider, so the default size was used.
  usedDefaults: Partial<Record<ProviderId, boolean>>;
  // Both keys are set and nothing was chosen, so NVIDIA was picked.
  preferredInferred: boolean;
  // Settings that could not be used, for the log.
  skipped: string[];
}

// A preferred provider without a key is ignored, as if none were set.
export function resolvePreferred(active: ProviderId[], preferred?: ProviderId): { provider: ProviderId; inferred: boolean } | undefined {
  if (preferred !== undefined && active.includes(preferred)) return { provider: preferred, inferred: false };
  if (active.length === 0) return undefined;
  if (active.length === 1) return { provider: active[0], inferred: false };
  return { provider: RECOMMENDED_PROVIDER, inferred: true };
}

// The first `size` recommendations; without a live list, the built-in order, unverified.
// It is worked out on every request, so it follows models the provider adds or drops.
export function topSet(provider: ProviderId, live: string[] | undefined, size: number): string[] {
  return (live ? recommend(provider, live) : DEFAULT_PRIORITY[provider]).slice(0, size);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function planAttempts(input: PlanInput): AttemptPlan {
  const { state, now } = input;
  const skipped: string[] = [];
  if (input.preferred !== undefined && !input.active.includes(input.preferred)) {
    skipped.push(`preferred: no key for ${PROVIDER_NAMES[input.preferred]}`);
  }
  const resolved = resolvePreferred(input.active, input.preferred);
  if (!resolved) return { order: [], attempts: [], usedDefaults: {}, preferredInferred: false, skipped };
  const order = [resolved.provider, ...input.active.filter(p => p !== resolved.provider)];
  const usedDefaults: Partial<Record<ProviderId, boolean>> = {};
  const blocked = (p: ProviderId, m: string) => (state.blockedModels.get(blockKey(p, m)) ?? 0) > now;
  const providerBlocked = (p: ProviderId) => (state.blockedProviders.get(p) ?? 0) > now;

  const sets = new Map<ProviderId, string[]>();
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
  const attempts: Attempt[] = sticky ? [{ provider: sticky.provider, model: sticky.model }] : [];
  for (const p of order) {
    if (providerBlocked(p)) continue;
    const isSticky = sticky?.provider === p;
    const group = shuffle((sets.get(p) ?? []).filter(m => !(isSticky && m === sticky.model)), input.random);
    for (const model of group.slice(0, isSticky ? MAX_PER_PROVIDER - 1 : MAX_PER_PROVIDER)) attempts.push({ provider: p, model });
  }
  return { order, attempts, usedDefaults, preferredInferred: resolved.inferred, skipped };
}

// Reads settings.json on every plan, so edits apply without a restart. Each distinct
// problem report is written to stderr only once per process.
export function createAttemptPlanner(deps: {
  providers: Map<ProviderId, Provider>;
  dataDir: string;
  random: () => number;
  warn: (m: string) => void;
}): (state: State, now: number) => Promise<AttemptPlan> {
  const warned = new Set<string>();
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
