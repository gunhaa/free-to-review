---
description: Choose how many recommended free models to use, per provider
allowed-tools: ["mcp__plugin_free-to-review_f2r__models", "AskUserQuestion"]
---

# Models

Write everything you show the user in English, whatever language the conversation uses.

## 1. Get the recommendations

Call the `models` tool of the `f2r` server with no arguments. It lists each provider (NVIDIA and OpenRouter), whether it has a key, its current choice, and its recommended models in order. If it returns an error, pass it on in one or two lines and stop.

## 2. Ask

Call `AskUserQuestion` once, with one question per provider in the order the tool listed them, including a provider without a key (its choice applies once its key is set):

- question: `How many recommended <provider> models should free-to-review use?`, followed by the provider's status from the tool, e.g. `(key set, used first)`.
- header: the provider's name, e.g. `NVIDIA`.
- options, in this order: `Top 3`, `Top 5`, `Top 10`. Add ` (current)` to the label of the current choice. The description says that free-to-review picks one of them at random and keeps the one that answers for 30 minutes.
- preview of each option: the numbered models that option includes, exactly as the tool listed them, one per line.

## 3. Save

Call the `models` tool once with the chosen size for each provider, e.g. `{"nvidia": 3, "openrouter": 10}`. Leave out a provider whose answer was not Top 3, Top 5 or Top 10. If nothing is left, say that nothing changed and stop.

Show the tool's result to the user as it is; do not translate it.
