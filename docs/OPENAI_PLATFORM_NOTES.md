# OpenAI Platform implementation notes

This worker uses the OpenAI Responses API through `src/lib/openai.ts`.

## Rules

- `OPENAI_API_KEY` is read only from Vercel server environment variables.
- Model name is configurable through `OPENAI_MODEL`.
- Structured JSON schema is required for task generation, research summaries, evaluations, and self-improvement.
- Token usage is logged to `execution_log`.
- Estimated spend is added to `daily_metrics.api_spend_cents`.
- Spend estimates intentionally default conservative unless exact pricing is configured.

## Codex handoff

Codex receives durable project instructions from `AGENTS.md`. The first task should be to run `npm run check`, inspect all migrations, and keep the system paused until live credentials are rotated and owner testing is approved.
