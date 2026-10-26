import { PROVIDER_NAMES } from "./types.ts";
import type { CallOptions, CallResult, Provider, ProviderId } from "./types.ts";

// Sends a call to its provider and tags the result with that provider.
export function createRouter(providers: Map<ProviderId, Provider>): (o: CallOptions) => Promise<CallResult> {
  return async ({ provider: id, ...o }) => {
    const provider = providers.get(id);
    if (!provider) return { ok: false, provider: id, model: o.model, retryable: false, message: `${PROVIDER_NAMES[id]} is not configured` };
    return { ...(await provider.call(o)), provider: id };
  };
}
