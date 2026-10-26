import { DEFAULT_SET_SIZE, resolvePreferred, topSet } from "./candidates.ts";
import { KEY_URLS, noKeyMessage } from "./config.ts";
import { isRecord } from "./guards.ts";
import type { ToolContext, ToolResult } from "./protocol.ts";
import { PROVIDER_CHOICES, PROVIDER_IDS, PROVIDER_NAMES, RECOMMENDED_PROVIDER, isProviderId } from "./providers/types.ts";
import type { ProviderId } from "./providers/types.ts";
import { TOP_SIZES, isTopSize, loadSettings, saveSettings, settingsPath } from "./settings.ts";
import type { TopSize } from "./settings.ts";
import type { StateStore } from "./state.ts";

// The user may leave the dialog open for a while before answering.
export const ELICIT_TIMEOUT_MS = 600_000;

export const modelsToolDefinition = {
  name: "models" as const,
  description:
    "Without arguments, lists each provider's recommended free models in order and how many of them free-to-review uses now. " +
    "With nvidia and/or openrouter, saves how many of that provider's recommended models to use (3, 5 or 10).",
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(
      PROVIDER_IDS.map(p => [p, { type: "integer", enum: [...TOP_SIZES], description: `How many of the recommended ${PROVIDER_NAMES[p]} models to use.` }]),
    ),
    additionalProperties: false,
  },
};

export const providerToolDefinition = {
  name: "provider" as const,
  description: "Choose which provider free-to-review uses first. Opens a dialog.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

const ok = (text: string): ToolResult => ({ text, isError: false });
const error = (text: string): ToolResult => ({ text, isError: true });

// Saving can fail on a broken file or an unwritable directory; that is reported, not thrown.
function save(dataDir: string, patch: Parameters<typeof saveSettings>[1]): string | undefined {
  try {
    saveSettings(dataDir, patch);
    return undefined;
  } catch (err) {
    return `Not saved: ${err instanceof Error ? err.message : String(err)}.`;
  }
}

const noKey = (p: ProviderId) => `${PROVIDER_NAMES[p]} has no API key. Set it with /plugin → free-to-review (${KEY_URLS[p]}).`;

// Resolves with the accepted content, or with the reply text when nothing should change.
async function elicit(ctx: ToolContext, message: string, properties: Record<string, object>): Promise<{ content: Record<string, unknown> } | { result: ToolResult }> {
  let reply: unknown;
  try {
    reply = await ctx.request("elicitation/create", { message, requestedSchema: { type: "object", properties } }, ELICIT_TIMEOUT_MS);
  } catch {
    return { result: ok("No changes (dialog timed out).") };
  }
  if (!isRecord(reply) || reply.action !== "accept") return { result: ok("No changes.") };
  return { content: isRecord(reply.content) ? reply.content : {} };
}

export async function configureProvider(deps: {
  active: ProviderId[];
  rejected?: ProviderId[];
  dataDir: string;
  state: StateStore;
  now: () => number;
  ctx: ToolContext;
}): Promise<ToolResult> {
  const path = settingsPath(deps.dataDir);
  if (deps.ctx.clientCapabilities.elicitation === undefined) {
    return error(`This client cannot show the provider dialog. Edit ${path} directly. Format: {"version":1,"preferred":"nvidia"}`);
  }
  const current = resolvePreferred(deps.active, loadSettings(deps.dataDir).preferred);
  if (!current) return error(noKeyMessage(deps.rejected ?? []));

  const label = (p: ProviderId) =>
    `${PROVIDER_NAMES[p]} (${[p === RECOMMENDED_PROVIDER ? "recommended" : "", deps.active.includes(p) ? "key set" : "no key", p === current.provider ? "current" : ""].filter(Boolean).join(", ")})`;
  const answer = await elicit(deps.ctx, "Choose which provider free-to-review uses first. The other one, if it has a key, answers when the first one fails. NVIDIA is recommended: its free trial has no daily cap, while OpenRouter allows 50 free requests a day.", {
    preferred: { type: "string", title: "Provider", oneOf: PROVIDER_IDS.map(p => ({ const: p, title: label(p) })), default: current.provider },
  });
  if ("result" in answer) return answer.result;

  const chosen = answer.content.preferred;
  if (!isProviderId(chosen)) return error(`Not saved: provider must be ${PROVIDER_CHOICES}.`);
  if (!deps.active.includes(chosen)) return error(`Not saved: ${noKey(chosen)}`);
  const failed = save(deps.dataDir, { preferred: chosen });
  if (failed) return error(failed);
  // The sticky model may belong to the old preference, so the next request starts fresh.
  const state = deps.state.load(deps.now());
  delete state.sticky;
  deps.state.save(state);
  const other = deps.active.find(p => p !== chosen);
  return ok(`Saved: ${PROVIDER_NAMES[chosen]} is used first${other ? `; ${PROVIDER_NAMES[other]} is the fallback` : ""}.`);
}

// Lists the recommendations for the command to ask about, or saves the sizes it was given.
export async function configureModels(deps: {
  active: ProviderId[];
  rejected?: ProviderId[];
  live: () => Promise<Map<ProviderId, string[] | undefined>>;
  dataDir: string;
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  const patch: Partial<Record<ProviderId, TopSize>> = {};
  for (const p of PROVIDER_IDS) {
    const size = deps.args[p];
    if (size === undefined) continue;
    if (!isTopSize(size)) return error(`${p} must be ${TOP_SIZES.join(", ")}.`);
    patch[p] = size;
  }
  if (deps.active.length === 0) return error(noKeyMessage(deps.rejected ?? []));
  const settings = loadSettings(deps.dataDir);
  const live = await deps.live();
  const preferred = resolvePreferred(deps.active, settings.preferred)?.provider;
  const unused = (p: ProviderId) => (deps.active.includes(p) ? "" : " It is used once its key is set.");

  const chosen = PROVIDER_IDS.filter(p => patch[p] !== undefined);
  if (chosen.length > 0) {
    const failed = save(deps.dataDir, { models: patch });
    if (failed) return error(failed);
    const lines = chosen.map(p => {
      const size = patch[p] as TopSize;
      const list = topSet(p, live.get(p), size).map(id => `- ${id}`).join("\n");
      return `Saved: ${PROVIDER_NAMES[p]} uses the top ${size} recommended models.${unused(p)} Now:\n${list}`;
    });
    return ok(lines.join("\n\n"));
  }

  // The preferred provider first, so the command asks about it first.
  const order = preferred ? [preferred, ...PROVIDER_IDS.filter(p => p !== preferred)] : [...PROVIDER_IDS];
  const sections = order.map(p => {
    const status = !deps.active.includes(p) ? "no key; used once a key is set" : p === preferred ? "key set, used first" : "key set, used when the other fails";
    const top = settings.models[p];
    const recommended = topSet(p, live.get(p), Math.max(...TOP_SIZES)).map((id, i) => `${i + 1}. ${id}`);
    return [
      `${PROVIDER_NAMES[p]} (${p}): ${status}.`,
      `Current: top ${top ?? DEFAULT_SET_SIZE}${top === undefined ? " (default)" : ""}.`,
      live.get(p) ? "Recommended now:" : "Recommended (built-in order; the live list was unavailable):",
      ...recommended,
    ].join("\n");
  });
  return ok(sections.join("\n\n"));
}
