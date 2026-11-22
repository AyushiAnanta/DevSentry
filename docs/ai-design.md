# AI analysis design

DevSentry supports Gemini and Groq through the `AIProvider` interface in `server/src/services/ai/aiService.ts`. `AI_PROVIDER` selects the provider and `AI_MODEL_GEMINI` / `AI_MODEL_GROQ` select the model IDs. Missing credentials disable AI without preventing static analysis from completing.

Each explanation request contains one finding and up to 21 source lines centered on it. Logic review sends at most 200 KB from each of the top configured risky files. The model sees repository content only inside explicit `UNTRUSTED_REPOSITORY_CODE` delimiters. Prompts say to treat it as data and ignore instructions in it. The provider is asked for JSON, then the response is parsed and checked against strict Zod schemas. Invalid JSON or schema output gets one extra request; invalid output after that is discarded. Provider 429 and 5xx errors retry with exponential backoff up to two times.

String literal values are redacted from secret/password finding context before a request is sent. Explanations, suggestions, and snippets are stored as plain strings. The client renders them as text and never interprets model output as HTML. LLM review findings are marked `source: "llm"` and are suggestions requiring human verification; line numbers are checked against the submitted file before they are stored.

AI calls have a per-scan cap and a global concurrency limit. AI failures are warnings, not scan failures. `scan.aiStatus` is `skipped`, `partial`, or `complete`. The top 20 files by risk are retained for source viewing, capped at 200 KB per file; other cloned files are removed with the temporary checkout.

The repository content is untrusted and may contain prompt injection. Delimiters and instructions reduce the chance of following embedded directions but are not a security boundary. No model output is executed, inserted as HTML, or used to change scan policy.
