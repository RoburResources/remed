# Robur remediation matrix

| Audit finding | Resolution in this pack |
|---|---|
| Missing Retell integration | `src/lib/integrations/retell.ts` implements create-phone-call and webhook verification. |
| MySQL Drizzle, no Supabase | `supabase/migrations/0001_robur_autonomous_worker.sql` creates Postgres tables, functions, RLS, and indexes. |
| Vercel cron incompatible | `vercel.json` plus `app/api/cron/**/route.ts` implement GET handlers with `CRON_SECRET`. |
| Retell wrong/absent call creation | Uses Retell `from_number`, `to_number`, and `override_agent_id` fields. |
| SMS webhook spoofable | `src/lib/integrations/twilio.ts` verifies `X-Twilio-Signature`; route rejects invalid requests. |
| Public dashboard reads | `app/api/admin/**` uses bearer `DASHBOARD_API_TOKEN`. |
| APPROVE approves wrong task | `src/lib/approval.ts` requires `APPROVE #<id> <nonce>`, hashes nonce, one-time use. |
| Email not sent | `src/lib/integrations/email.ts` sends via Make.com webhook and records provider message rows. `app/api/webhooks/make/email/route.ts` handles status/reply/opt-out callbacks. |
| LLM-only research | `src/lib/scanners/austender.ts` fetches AusTender current ATM page and creates opportunity records/tasks. |
| No evaluator loop | `src/lib/workers/evaluator.ts` writes `evaluations` from completed tasks and provider outcomes. |
| No opportunity scanner | Task generator calls `scanAusTenderOpportunities`; opportunities are upserted by source URL. |
| Spend tracking unreliable | OpenAI wrapper records token usage and conservative estimated cents in `daily_metrics`. |
| Duplicate queue claims | `claim_next_task` Postgres RPC uses `FOR UPDATE SKIP LOCKED` and task leases. |
| No compliance ledger | `contacts`, `compliance_events`, opt-out handling, DNC/contact-hour gates, consent checks. |
| No dependency lockfile | `package-lock.json` is generated and CI uses `npm ci`. |
| Generated TypeScript build info tracked | `tsconfig.tsbuildinfo` is removed and future build info is written under ignored `.next/cache`. |
| OpenAI spend cap tracked after calls only | `reserveApiSpendBudget` reads current spend and max cap before each Responses API call and blocks/logs if the estimate would exceed the daily cap. |
| Stale `in_progress` tasks can stick forever | `recover_stale_in_progress_tasks` requeues stale tasks below max attempts and fails them at the retry bound, with per-task execution logs. |
| Twilio SMS webhook duplicate delivery | Signed Twilio callbacks are recorded in `webhook_events` by `MessageSid` before side effects. |
| Make email webhook duplicate delivery | Authenticated Make callbacks are recorded in `webhook_events` by provider event/message/status IDs or a stable payload hash. |
| `supabase/seed.sql` duplicates goals | Seeded goals use a `goals(goal_text)` conflict target and update existing rows. |
| `web_research` SSRF exposure | `fetchWithUrlSafety` blocks unsafe schemes, local/private/reserved IPs, DNS failures, and redirects to unsafe destinations. |
| Approval expiry had no runtime caller | Task executor runs `expireOldApprovals` before task claiming. |
| No CI workflow | `.github/workflows/ci.yml` runs `npm ci`, typecheck, tests, and build. |
| No staging smoke test | `scripts/staging-smoke.mjs` validates protected cron/admin endpoints and verifies outreach metrics do not increase. |
