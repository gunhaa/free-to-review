English | [한국어](README.ko.md)

# free-to-review

**Code reviews and answers from free LLMs, inside Claude Code.**

free-to-review is a Claude Code plugin with two commands. Each one hands your work to a *different* LLM through [OpenRouter](https://openrouter.ai)'s free (`:free`) models, so it costs nothing. A model that reviews its own work tends to repeat its own blind spots. A model with different training catches different problems.

| Command | What it does |
|---|---|
| `/free-to-review:review [target]` | Reviews your code with another model, then Claude checks each finding. |
| `/free-to-review:request <prompt>` | Sends any request to another model and shows its answer. |

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
Review by minimax/minimax-m3.1-flash:free:
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

## Install

```
/plugin marketplace add gunhaa/free-to-review
/plugin install free-to-review@free-to-review
```

When prompted, enter your OpenRouter API key (create one at [openrouter.ai/keys](https://openrouter.ai/keys)). Claude Code stores it in secure storage. The plugin does not start until the key is set; you can change it later with `/plugin` → free-to-review → configure.

## Configuration

Set these through the plugin's configuration in Claude Code:

| Setting | Default | Meaning |
|---|---|---|
| OpenRouter API key | — (required) | Your OpenRouter API key |
| Panel size | `1` | How many models answer each command, 1–3, from different vendors when possible. Each model uses one request of your free quota. |
| Preferred models | empty | Comma-separated model IDs in preference order. Only IDs ending in `:free` are used; others are ignored with a warning. Empty = pick free models automatically. |

Free models are picked automatically and cached for an hour. If one is rate-limited or unavailable, the next one is tried. Only models whose ID ends in `:free` are ever used, so a request cannot reach a paid model.

## Use from other MCP clients

The commands are Claude Code features, but the server behind them is a plain MCP server with one tool, `ask`. Clone the repository (the compiled server is committed in `server/dist/`) and add it to your client's configuration:

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

The server reads only environment variables: `OPENROUTER_API_KEY`, `F2R_PANEL`, `F2R_MODELS`, `F2R_TIMEOUT_MS` (default `120000`), and `F2R_MAX_PROMPT_CHARS` (default `100000`; longer prompts are rejected instead of wasting quota). Invalid values fall back to the default with a warning on stderr.

## Data and privacy

- Everything a command sends goes to OpenRouter and from there to the provider of the selected model.
- Free endpoints may log your prompts and may use them for training. Check each model's provider policy on OpenRouter.
- Do not send confidential code, secrets, credentials, or personal data. Both commands tell Claude to send only the material needed and to redact anything sensitive.
- The server itself stores nothing and sends nothing anywhere else.

## Free-tier limits

OpenRouter limits free models to 20 requests per minute and 50 requests per day; after you buy at least $10 of credits, the daily limit rises to 1,000. Failed requests may still count toward the limit. When the limit is hit, the command reports the reset time when OpenRouter provides it.

## Requirements

Node.js 20 or newer on `PATH`.

## Development

Requires Node.js 22.18 or newer (tests run TypeScript directly).

```
cd server
npm install
npm test        # builds dist/ and runs all tests
npm run check   # fails if the committed dist/ is out of date
OPENROUTER_API_KEY=... npm run smoke   # one real review request
```

## License

[MIT](LICENSE)
