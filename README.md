English | [한국어](README.ko.md)

# free-to-review

**Code reviews and answers from free LLMs, inside Claude Code.**

free-to-review is a Claude Code plugin that hands your work to a *different* LLM, using the free models of [NVIDIA build](https://build.nvidia.com) or [OpenRouter](https://openrouter.ai)'s free (`:free`) models, so it costs nothing. A model that reviews its own work tends to repeat its own blind spots. A model with different training catches different problems.

| Command | What it does |
|---|---|
| `/free-to-review:review [target]` | Reviews your code with another model, then Claude checks each finding. |
| `/free-to-review:request <prompt>` | Sends any request to another model and shows its answer. |
| `/free-to-review:provider` | Chooses which provider (NVIDIA or OpenRouter) to use first. |
| `/free-to-review:models` | Chooses how many recommended free models to use, per provider. |

## `/free-to-review:review`

Delegates a code review to another model and verifies the result.

```
/free-to-review:review                   # uncommitted changes, or the last commit if there are none
/free-to-review:review src/auth.ts       # specific files or directories
/free-to-review:review main              # everything on this branch since main
/free-to-review:review the retry logic   # describe what to look at
```

1. Claude collects the code: the diff, the files, or the code you described.
2. Claude sends it to a free model, with a short note on its purpose, language, and constraints.
3. The model's findings come back. Claude checks each one against the actual code.
4. You get the findings split into valid and rejected, each with a reason. Claude asks before changing any code.

```
Review by deepseek-ai/deepseek-v4.1-flash (NVIDIA):
Valid:
- Off-by-one in the pagination loop — src/list.ts:42 reads one item past the end
Rejected:
- "Validate the page size" — the route handler already validates it
```

## `/free-to-review:request`

Sends any request to another model. The review command was the reason this plugin exists, but a second model is useful for more than reviews:

```
/free-to-review:request Critique the migration plan we just wrote. What could go wrong?
/free-to-review:request What edge cases am I missing in parseDate in src/date.ts?
/free-to-review:request Compare a write-through cache and a TTL cache for this read-heavy API
/free-to-review:request Suggest clearer names for the functions in src/sync.ts
```

Your request is sent unchanged. If it refers to files or to earlier work in the conversation, Claude attaches that material, because the other model sees only what is sent. The answer is shown as it came back, followed by a short note from Claude on anything that looks wrong.

## Getting started

1. **Set a key.** Enter an NVIDIA key, an OpenRouter key, or both when you install (see [Install](#install)). With one key, nothing else is needed.
2. **`/free-to-review:provider`** (optional). With both keys, choose which provider is used first; the other one answers when the first one fails. Until you choose, NVIDIA is used first and the plugin shows a one-time tip.
3. **`/free-to-review:models`** (optional). Choose how many of each provider's recommended models to use: the top 3, 5 or 10. Until you choose, the top 5 are used.

## `/free-to-review:provider`

Opens a dialog listing both providers with their status, for example `NVIDIA (recommended, key set, current)` and `OpenRouter (no key)`. NVIDIA is recommended because its free trial has no daily cap. A provider without a key cannot be chosen.

## `/free-to-review:models`

Asks, for each provider, how many of its recommended free models to use: the **top 3**, **top 5** (the default) or **top 10**. Each choice previews the models it includes, in order. A provider without a key is asked about too; its choice applies once its key is set. The list is worked out again on each request, so models the provider adds or drops are followed.

The recommendations are built in and updated with each release; models that a provider no longer lists are skipped.

Your choices are saved in `settings.json` in the plugin's data directory (`~/.claude/plugins/data/<plugin id>/`; the commands show the exact path). You can also edit that file by hand:

```json
{ "version": 1, "preferred": "nvidia", "models": { "nvidia": 3, "openrouter": 10 } }
```

If your terminal cannot show the provider dialog, the command prints the file's path and format instead.

## How it works

- Each request picks a model at random from the chosen set (or the recommended set) of the provider used first.
- A model that answers is reused first for the next 30 minutes, across Claude Code sessions. If it came from the other provider, it is reused for 10 minutes. A model that fails is dropped from that spot at once.
- Up to 3 models are tried per provider. If all of them fail, the other provider is tried, when it has a key. The answer then says why the first provider did not answer.
- A request gives up after 5 minutes.
- NVIDIA answers are streamed. A model that sends nothing within 30 seconds is usually stuck in NVIDIA's queue, so the next model is tried.
- Models that answer 403 or 404 are skipped for an hour, and a rate-limited provider until its limit resets. This state is kept in `state.json` next to `settings.json`; deleting it is safe.

## Install

```
/plugin marketplace add gunhaa/free-to-review
/plugin install free-to-review@free-to-review
```

When prompted, enter an NVIDIA API key ([build.nvidia.com](https://build.nvidia.com)), an OpenRouter API key ([openrouter.ai/keys](https://openrouter.ai/keys)), or both. Claude Code stores them in secure storage. With both keys, choose which one is used first with `/free-to-review:provider`. You can change the keys later with `/plugin` → free-to-review → configure.

### Update

Updates are not installed automatically. To get a new version, refresh the marketplace, update the plugin, and restart Claude Code:

```
claude plugin marketplace update free-to-review
claude plugin update free-to-review@free-to-review
```

Your API key and settings are kept. If you installed the plugin from another marketplace, put that marketplace's name in place of the marketplace name `free-to-review`: in the first command, and after the `@` in the second.

## Configuration

Set these through the plugin's configuration in Claude Code:

| Setting | Default | Meaning |
|---|---|---|
| NVIDIA API key | empty | Your NVIDIA build API key. |
| OpenRouter API key | empty | Your OpenRouter API key. |

Set at least one key. On OpenRouter, only models whose ID ends in `:free` are ever used, so a request cannot reach a paid model. Damage from copying a key through an auto-correcting app is undone: a `—` or `–` becomes `--` again ("smart dashes" turn `--` into them), and invisible characters are removed. A key with any other non-ASCII character is ignored, and the commands say so.

## Use from other MCP clients

The commands are Claude Code features, but the server behind them is a plain MCP server with three tools: `ask`; `provider`, which needs a client that supports elicitation; and `models`, which lists the recommendations without arguments and saves the sizes it is given. Clone the repository (the compiled server is committed in `server/dist/`) and add it to your client's configuration:

```json
{
  "mcpServers": {
    "f2r": {
      "command": "node",
      "args": ["/path/to/free-to-review/server/dist/index.js"],
      "env": {
        "NVIDIA_API_KEY": "<your key>"
      }
    }
  }
}
```

The server reads only environment variables: `NVIDIA_API_KEY` and `OPENROUTER_API_KEY` (at least one), plus these advanced settings:

| Variable | Default | Meaning |
|---|---|---|
| `F2R_TIMEOUT_MS` | `120000` | Time limit for one attempt. |
| `F2R_FIRST_BYTE_MS` | `30000` | NVIDIA only: give up on a model that sends nothing for this long (at least `1000`). |
| `F2R_MAX_PROMPT_CHARS` | `100000` | Longer prompts are rejected instead of wasting quota. |
| `F2R_DATA_DIR` | `~/.free-to-review` | Where `settings.json` and `state.json` live. |

Invalid values fall back to the default with a warning on stderr.

## Data and privacy

- Everything a command sends goes to NVIDIA or OpenRouter, and from OpenRouter on to the provider of the selected model.
- Free endpoints may log your prompts and may use them for training. Check NVIDIA's terms and each model's provider policy on OpenRouter.
- Do not send confidential code, secrets, credentials, or personal data. Both commands tell Claude to send only the material needed and to redact anything sensitive.
- The server stores only your choices (`settings.json`) and which models recently answered or failed (`state.json`), and sends nothing anywhere else.

## Free-tier limits

NVIDIA's free trial allows about 40 requests per minute, with no daily cap. OpenRouter limits free models to 20 requests per minute and 50 requests per day; after you buy at least $10 of credits, the daily limit rises to 1,000. Failed requests may still count toward the limits. When a provider's limit is hit, the plugin moves on to the other provider (when it has a key) and reports the reset time when the provider gives one.

Both free tiers are meant for development and evaluation, not for production use.

## Requirements

Node.js 20 or newer on `PATH`.

## Development

Requires Node.js 22.18 or newer (tests run TypeScript directly).

```
cd server
npm install
npm test        # builds dist/ and runs all tests
npm run check   # fails if the committed dist/ is out of date
NVIDIA_API_KEY=... npm run smoke   # one real review request (OPENROUTER_API_KEY works too)
```

## License

[MIT](LICENSE)
