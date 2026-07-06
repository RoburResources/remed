# Codex instructions for Robur Autonomous Worker

You are working on a production system for Robur Resources, a scrap metal business in Perth, Western Australia.

## Non-negotiables

- Do not use live credentials in code, tests, logs, fixtures, screenshots, or commit messages.
- Do not make outbound calls, send SMS, or send email from tests.
- Do not bypass `CRON_SECRET`, `DASHBOARD_API_TOKEN`, Twilio signature verification, Retell signature verification, or compliance checks.
- Never convert protected admin/dashboard endpoints to public endpoints.
- Do not reintroduce MySQL Drizzle or Manus SDK dependencies.
- Use Supabase Postgres migrations for schema changes.
- Use Vercel `GET` route handlers for cron endpoints.
- Preserve approval command format: `APPROVE #<task_id> <nonce>` and `REJECT #<task_id> <nonce>`.
- Keep external contact blocked unless contact consent/provenance and channel rules are satisfied.
- Keep `external_contact_requires_owner_approval=true` as a code-level invariant. Ordinary chat, task output, self-improvement, or config writes must not remove task-specific owner approval for non-owner calls, SMS, WhatsApp, email, or other provider-mediated outreach.
- Protected policy changes must become `policy_change_requests` proposals for human review. Do not directly apply requests that weaken approvals, compliance, DNC, opt-out handling, webhook verification/idempotency, stale recovery, SSRF protection, kill-switch behavior, external-contact defaults, or deployment review.

## Definition of done

- `npm run typecheck` passes.
- `npm run test` passes.
- New database changes include a Supabase migration.
- Any new provider webhook has signature verification and idempotency.
- Any new external-contact capability writes to `execution_log`, `outbound_messages` or `retell_calls`, and `compliance_events`.
- Any action that can spend money updates `daily_metrics.api_spend_cents` or another explicit spend metric.
- Any user-visible operational endpoint is protected.
- Chat/admin change requests that touch protected policies create an audit proposal and do not mutate runtime config.

## Preferred style

- TypeScript strict mode.
- Small pure functions for safety and parsing logic.
- Server-only Supabase service-role access.
- Minimal comments; document why a safety guard exists.
