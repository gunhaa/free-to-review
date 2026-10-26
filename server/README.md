# free-to-review

MCP server behind the free-to-review plugin: sends code reviews and requests to free models on NVIDIA build or OpenRouter, trying the other provider when the preferred one fails.

Environment variables: `NVIDIA_API_KEY`, `OPENROUTER_API_KEY` (set at least one), `F2R_TIMEOUT_MS`, `F2R_FIRST_BYTE_MS`, `F2R_MAX_PROMPT_CHARS`, `F2R_DATA_DIR`.

See the full documentation at https://github.com/gunhaa/free-to-review#readme.
