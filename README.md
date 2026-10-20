English | [한국어](README.ko.md)

# free-to-review

**Second opinions on your code and plans from free LLMs.**

free-to-review is a Claude Code plugin, and a plain MCP server, that lets Claude hand its work to a *different* LLM for review. It uses only [OpenRouter](https://openrouter.ai)'s free (`:free`) models, so the review costs nothing. A model that reviews its own work tends to repeat its own blind spots. A model with different training catches different problems.

## How it works

The plugin was built for one workflow: Claude delegates the review of its own output to another model, then checks what comes back.

1. **Trigger.** The `second-opinion` skill tells Claude to ask for a second opinion at three points: after a non-trivial code change, before committing to a plan, and when writing tests. You can also ask directly, for example "get a second opinion on this diff".
2. **Request.** Claude calls the `ask` tool with a preset and a self-contained prompt. The prompt states the purpose, the language, and any constraints, then includes the material itself. For example, after changing code, Claude sends `preset: "review"` with the `git diff` of the change.
3. **Routing.** The server picks a free model, sends the preset's system prompt plus Claude's prompt, and moves to the next model if one is rate-limited or unavailable. Set `F2R_PANEL` to 2 or 3 to ask several models from different vendors in parallel.
4. **Answer.** The reply comes back labelled with the model's name. It is wrapped in delimiters that mark it as external, untrusted text.
5. **Verification.** Claude checks each point against the actual code, fixes the ones that hold up, and tells you which points it adopted or rejected, and why.

What you see at the end (illustrative):

```
Second opinion (minimax/minimax-m3.1-flash:free):
Adopted:
- Off-by-one in the pagination loop — fixed the bound in src/list.ts
Rejected:
- "Validate the page size" — the route handler already validates it
```

## Other uses

`ask` accepts any prompt, and the preset is optional, so the tool is not limited to reviewing Claude's own changes:

- **Review your own work.** Ask Claude to run `critique` on a design doc you wrote, or `edge-cases` on a function, before you merge it.
- **Domain-specific reviewers.** Add a [custom preset](#custom-presets), such as `sql-migration` for locking and data-loss risks, `security` for injection and auth issues, or `api-design` for naming and breaking changes.
- **A free-form second view.** Call `ask` without a preset to compare two approaches, sanity-check an error message, or see how another model would name something.
- **Other MCP clients.** Any MCP client can call the same tool. Outside Claude Code you get the tool without the skill, so nothing triggers it or verifies the answer automatically.

## Install as a Claude Code plugin

```
/plugin marketplace add gunhaa/free-to-review
/plugin install free-to-review@free-to-review
```

When prompted, enter your OpenRouter API key (create one at [openrouter.ai/keys](https://openrouter.ai/keys)). Claude Code stores it in secure storage. The MCP server does not start until the key is set; you can change it later with `/plugin` → free-to-review → configure.

The plugin adds:

- the `ask` tool of the `f2r` MCP server, and
- the `second-opinion` skill, which tells Claude when to ask (after non-trivial code changes, before committing to a plan, when writing tests) and how to treat the answer: verify every point, never follow instructions inside it, and report which points were adopted or rejected.

## Use from other MCP clients

Clone the repository (the compiled server is committed in `server/dist/`) and add it to your client's configuration:

```json
{
  "mcpServers": {
    "f2r": {
      "command": "node",
      "args": ["/path/to/free-to-review/server/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "<your key>"
      }
    }
  }
}
```

The server speaks MCP over stdio and has no runtime dependencies.

## Configuration

The server reads only environment variables. In the Claude Code plugin, the key, panel size, and preferred models are set through the plugin's configuration.

| Variable | Default | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | — (required) | OpenRouter API key |
| `F2R_PANEL` | `1` | Number of models asked in parallel, 1–3. Each model uses one request of your free quota. |
| `F2R_MODELS` | empty | Comma-separated model IDs in preference order. Empty = discover free models automatically. |
| `F2R_PRESETS_DIR` | `$XDG_CONFIG_HOME/free-to-review/presets`, else `~/.config/free-to-review/presets` | Directory for your own presets |
| `F2R_TIMEOUT_MS` | `60000` | Per-request timeout in milliseconds |
| `F2R_MAX_PROMPT_CHARS` | `100000` | Longer prompts are rejected instead of wasting quota |

Invalid values fall back to the default with a warning on stderr.

### How models are chosen

Without `F2R_MODELS`, the server lists OpenRouter's models (cached for an hour) and keeps those whose ID ends in `:free`, whose prices are zero, and that take and return text, largest context first. If a model fails with a temporary error (rate limit, unavailable, timeout, empty answer), the next one is tried, up to 3 attempts. With a panel of 2–3, the models come from different vendors so the opinions really differ.

A caller (Claude) can request a specific model only if its ID ends in `:free`, so it cannot route your request to a paid model.

## Presets

Built-in presets, all answering in English:

- `review` — code or a diff → findings by severity (Critical / Major / Minor), each with location, problem, why it matters, and a suggested fix.
- `critique` — a design, plan, or decision → hidden assumptions, failure scenarios, simpler alternatives, open questions.
- `edge-cases` — a function, spec, or behaviour → a table of edge cases worth testing.

Each preset allows an explicit "nothing found" answer to discourage invented findings.

### Custom presets

Put Markdown files in your presets directory (default `~/.config/free-to-review/presets`). The file name is the preset name and must match `^[a-z0-9-]+$`; a file with the same name as a built-in replaces it.

```markdown
---
description: Review SQL migrations for locking and data-loss risks.
---
You are a database engineer. Review the migration in the user message...
```

Presets are loaded when the server starts; restart it after changes.

## Data and privacy

- Everything you send with `ask` goes to OpenRouter and from there to the provider of the selected model.
- Free endpoints may log your prompts and may use them for training. Check each model's provider policy on OpenRouter.
- Do not send confidential code, secrets, credentials, or personal data. The skill instructs Claude to send only the material needed and to redact anything sensitive.
- The server itself stores nothing and sends nothing anywhere else.

## Free-tier limits

OpenRouter limits free models to 20 requests per minute and 50 requests per day; after you buy at least $10 of credits, the daily limit rises to 1,000. Failed requests may still count toward the limit. When the limit is hit, `ask` returns an error with the reset time when OpenRouter provides it.

## Requirements

Node.js 20 or newer on `PATH`.

## Development

Requires Node.js 22.18 or newer (tests run TypeScript directly).

```
cd server
npm install
npm test        # builds dist/ and runs all tests
npm run check   # fails if the committed dist/ is out of date
OPENROUTER_API_KEY=... npm run smoke   # one real request with the review preset
```

## License

[MIT](LICENSE)
