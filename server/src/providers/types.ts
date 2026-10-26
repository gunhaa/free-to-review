export type ProviderId = "nvidia" | "openrouter";

// Display order only; the preferred provider decides which one is tried first.
export const PROVIDER_IDS: readonly ProviderId[] = ["nvidia", "openrouter"];

// Used first when both keys are set and none was chosen, and marked in the provider dialog:
// NVIDIA's free trial has no daily cap, while OpenRouter allows 50 free requests a day.
export const RECOMMENDED_PROVIDER: ProviderId = "nvidia";

export const PROVIDER_NAMES: Record<ProviderId, string> = { nvidia: "NVIDIA", openrouter: "OpenRouter" };

// For messages: "nvidia" or "openrouter".
export const PROVIDER_CHOICES = PROVIDER_IDS.map(p => `"${p}"`).join(" or ");

export const isProviderId = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);

export type ChatResult =
  | { ok: true; model: string; text: string }
  // keyRejected: the provider refused the API key, so none of its models can answer.
  | { ok: false; model: string; retryable: boolean; status?: number; keyRejected?: true; message: string; resetAt?: number };

export type CallResult = ChatResult & { provider: ProviderId };

export interface CallOptions {
  provider: ProviderId;
  model: string;
  system?: string;
  prompt: string;
  timeoutMs: number;
}

export interface Provider {
  id: ProviderId;
  listModels(): Promise<string[]>;
  call(o: Omit<CallOptions, "provider">): Promise<ChatResult>;
}
