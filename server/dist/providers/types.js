// Display order only; the preferred provider decides which one is tried first.
export const PROVIDER_IDS = ["nvidia", "openrouter"];
// Used first when both keys are set and none was chosen, and marked in the provider dialog:
// NVIDIA's free trial has no daily cap, while OpenRouter allows 50 free requests a day.
export const RECOMMENDED_PROVIDER = "nvidia";
export const PROVIDER_NAMES = { nvidia: "NVIDIA", openrouter: "OpenRouter" };
// For messages: "nvidia" or "openrouter".
export const PROVIDER_CHOICES = PROVIDER_IDS.map(p => `"${p}"`).join(" or ");
export const isProviderId = (v) => typeof v === "string" && PROVIDER_IDS.includes(v);
