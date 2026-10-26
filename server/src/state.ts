import { join } from "node:path";
import { readJson, writeAtomic } from "./files.ts";
import { isRecord } from "./guards.ts";
import { isProviderId } from "./providers/types.ts";
import type { CallResult, ProviderId } from "./providers/types.ts";

export const STATE_FILE = "state.json";

// A model that answered is tried first for this long: shorter when it came from the fallback provider.
export const STICKY_PREFERRED_MS = 1_800_000;
export const STICKY_FALLBACK_MS = 600_000;
// A model refused with 403/404 is skipped for this long.
export const BLOCK_TTL_MS = 3_600_000;
// A rate-limited provider without a reset time is skipped for this long.
export const PROVIDER_BLOCK_MS = 60_000;

export interface Sticky {
  provider: ProviderId;
  model: string;
  until: number;
}

export interface State {
  sticky?: Sticky;
  blockedModels: Map<string, number>;
  blockedProviders: Map<ProviderId, number>;
}

export interface StateStore {
  load(now: number): State;
  save(state: State): void;
}

export function blockKey(provider: ProviderId, model: string): string {
  return `${provider} ${model}`;
}

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function live(state: State, now: number): State {
  const out: State = { blockedModels: new Map(), blockedProviders: new Map() };
  if (state.sticky && state.sticky.until > now) out.sticky = state.sticky;
  for (const [k, t] of state.blockedModels) if (t > now) out.blockedModels.set(k, t);
  for (const [k, t] of state.blockedProviders) if (t > now) out.blockedProviders.set(k, t);
  return out;
}

// Remembers what a failed call says about the model and the provider; true when state changed.
export function recordFailure(state: State, result: Extract<CallResult, { ok: false }>, now: number): boolean {
  const { provider, model } = result;
  let changed = false;
  if (state.sticky?.provider === provider && state.sticky.model === model) {
    delete state.sticky;
    changed = true;
  }
  // A rejected key says nothing about the model.
  if (!result.keyRejected && (result.status === 403 || result.status === 404)) {
    state.blockedModels.set(blockKey(provider, model), now + BLOCK_TTL_MS);
    changed = true;
  }
  // A NVIDIA 429 is the account's per-minute limit. OpenRouter also answers 429 for one free
  // model whose upstream is busy; only a 429 with a reset time is its account limit.
  if (result.status === 429 && (provider === "nvidia" || result.resetAt !== undefined)) {
    state.blockedProviders.set(provider, result.resetAt !== undefined && result.resetAt > now ? result.resetAt : now + PROVIDER_BLOCK_MS);
    changed = true;
  }
  return changed;
}

// The file is a cache: anything unreadable is dropped silently, and a failed save only warns.
export function createStateStore(dataDir: string, warn: (m: string) => void, now: () => number = Date.now): StateStore {
  const path = join(dataDir, STATE_FILE);
  let warned = false;
  return {
    load(at) {
      const state: State = { blockedModels: new Map(), blockedProviders: new Map() };
      let body: unknown;
      try {
        body = readJson(path);
      } catch {
        return state;
      }
      if (!isRecord(body) || body.version !== 1) return state;
      const s = body.sticky;
      if (isRecord(s) && isProviderId(s.provider) && typeof s.model === "string" && isTime(s.until)) state.sticky = { provider: s.provider, model: s.model, until: s.until };
      if (isRecord(body.blockedModels)) for (const [k, t] of Object.entries(body.blockedModels)) if (isTime(t)) state.blockedModels.set(k, t);
      if (isRecord(body.blockedProviders)) for (const [k, t] of Object.entries(body.blockedProviders)) if (isProviderId(k) && isTime(t)) state.blockedProviders.set(k, t);
      return live(state, at);
    },
    save(state) {
      const s = live(state, now());
      try {
        writeAtomic(path, dataDir, {
          version: 1,
          ...(s.sticky ? { sticky: s.sticky } : {}),
          blockedModels: Object.fromEntries(s.blockedModels),
          blockedProviders: Object.fromEntries(s.blockedProviders),
        });
      } catch (err) {
        if (warned) return;
        warned = true;
        warn(`Could not save ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
