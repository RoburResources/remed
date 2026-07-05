# Codex task — apply Robur forensic remediation

## Goal

Replace the unsafe prototype with the Vercel + Supabase implementation in this pack, then run checks and open a pull request.

## Context

The forensic audit found:

1. Missing `server/integrations/retell.ts`.
2. MySQL Drizzle schema instead of Supabase Postgres.
3. No `vercel.json`; cron endpoints were POST/Express rather than Vercel GET route handlers.
4. Twilio inbound SMS was spoofable.
5. Dashboard reads were public.
6. Approval flow approved “highest priority” task rather than a specific task/nonce.
7. Email was only drafted, not sent.
8. Research/opportunity scanning was not real.
9. Evaluation/opportunity tables had no feedback loop.
10. Spend tracking was not reliable.
11. Queue claiming was not idempotent or locked.
12. Compliance ledger and contact permission checks were missing.

## Steps

1. Remove Manus SDK/Express worker code from production routes.
2. Apply all files in this remediation pack.
3. Apply `supabase/migrations/0001_robur_autonomous_worker.sql` to the Supabase project.
4. Apply `supabase/seed.sql`.
5. Set Vercel environment variables from `.env.example`.
6. Run:
   ```bash
   npm install
   npm run check
   npm run build
   ```
7. Verify these endpoints reject unauthenticated requests:
   - `/api/cron/task-generator`
   - `/api/cron/task-executor`
   - `/api/admin/status`
   - `/api/webhooks/twilio/sms` with invalid Twilio signature
   - `/api/webhooks/retell` with invalid Retell signature
8. Verify `claim_next_task` claims a task once only under concurrent executor calls.
9. Keep `kill_switch_active=true` until Michael approves live testing.

## Acceptance tests

- No code imports `../integrations/retell` from the old path.
- No MySQL or Drizzle dependency remains.
- `vercel.json` has six cron entries using UTC schedules.
- `task_queue` has approval nonce fields and lease fields.
- `contacts` and `compliance_events` exist.
- Approval requires task ID and one-time nonce.
- STOP from owner pauses the system.
- STOP from non-owner records opt-out but cannot pause/resume the system.
- Retell `call_analyzed`/`call_ended` updates the matching task/call record idempotently.
