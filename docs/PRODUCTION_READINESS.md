# Production Readiness

## Summary

This repository is now a buildable, testable staging candidate for an internal-only Robur Autonomous Worker cycle. It is not ready for production external outreach.

The hardening pass focused on fail-closed controls: OpenAI spend is reserved before calls, stale in-progress tasks are recovered or failed with a bounded retry policy, provider webhooks are authenticated and idempotent, research fetches reject unsafe URLs and redirects, seeded goals are idempotent, CI exists, and staging smoke testing checks that no external outreach metrics move.

## Commands Run

| Command | Result |
|---|---|
| `npm.cmd install` | Passed. Generated `package-lock.json`. npm reported 2 moderate advisories. |
| `npm.cmd run typecheck` | Passed. |
| `npm.cmd run test` | Passed: 12 files, 29 tests. |
| `npm.cmd run build` | Passed. Next.js production build completed successfully. |

PowerShell blocked the `npm` wrapper on this workstation, so `npm.cmd` was used for local validation. CI uses standard `npm ci` and npm scripts on Ubuntu.

## What Was Hardened

- Added deterministic npm lockfile support.
- Removed tracked `tsconfig.tsbuildinfo` and moved TypeScript build info to ignored `.next/cache`.
- Added Vitest alias config so tests resolve the same `@/*` imports as the app.
- Added OpenAI spend reservation before every Responses API call.
- Added bounded stale `in_progress` task recovery through Supabase RPC.
- Wired approval expiry and stale task recovery into the task executor before task claiming.
- Added Twilio SMS webhook idempotency by `MessageSid`.
- Added Make email webhook idempotency by explicit provider IDs or stable payload hash.
- Confirmed and strengthened Retell webhook idempotency with stable fallback event IDs.
- Added SSRF protection for web research and scanner fetches.
- Made seeded goals idempotent through a `goal_text` conflict target.
- Added minimal GitHub Actions CI.
- Added a staging smoke-test script.
- Added tests for auth, approvals, compliance fail-closed behavior, OpenAI spend preflight, stale recovery policy, webhook idempotency, seed idempotency, Retell/Twilio signatures, and SSRF blocking.

## Migration Instructions

Apply the Supabase migration before running workers:

```bash
supabase db push
```

Or apply `supabase/migrations/0001_robur_autonomous_worker.sql` through the Supabase SQL editor for a fresh staging project.

The migration includes:

- `task_queue.attempt_count`
- `task_queue.max_attempts`
- `recover_stale_in_progress_tasks(stale_after_seconds, default_max_attempts)`
- unique seeded-goal protection on `goals(goal_text)`
- existing `expire_old_approvals()`

## Seed Instructions

After migration, apply:

```bash
supabase db reset
```

For an existing staging database, run `supabase/seed.sql` manually after confirming no production data is present. Repeated seed runs update the same seeded Robur goals instead of duplicating them.

## Staging Smoke Test

Deploy to a staging Vercel environment with rotated, non-production credentials. Keep `kill_switch_active=true` or `external_contact_enabled=false`.

Required local environment variables:

```bash
STAGING_BASE_URL=https://your-staging-deployment.vercel.app
CRON_SECRET=...
DASHBOARD_API_TOKEN=...
STAGING_CONFIRM_NON_PRODUCTION=true
```

Run:

```bash
npm run smoke:staging
```

The script:

- reads protected `/api/admin/status`,
- confirms either the kill switch is active or external contact is disabled,
- calls task generator and task executor cron endpoints with `Authorization: Bearer $CRON_SECRET`,
- reads status again,
- fails if calls, emails, or SMS metrics increased,
- prints task/log/metric reconciliation.

## Safety Defaults

- `kill_switch_active=true` in `supabase/seed.sql`.
- `external_contact_enabled=false` in `supabase/seed.sql`.
- Cron routes require `CRON_SECRET`.
- Admin routes require `DASHBOARD_API_TOKEN`.
- Twilio SMS webhooks require Twilio signature verification.
- Retell webhooks require Retell signature verification.
- Make email webhooks require `x-robur-webhook-secret`.
- Tests use mocks/fakes and do not call real Twilio, Retell, Make, OpenAI, or external people.

## Safety Proof

| Control | Enforcement |
|---|---|
| Kill switch default | Seed sets `kill_switch_active=true`; task generation, execution, evaluation, self-improvement, and briefings skip when active. |
| External contact disabled default | Seed sets `external_contact_enabled=false`; `assertExternalContactAllowed` fails closed before calls, emails, or SMS to non-owner targets. |
| OpenAI spend cap | `createStructuredOutput` calls `reserveApiSpendBudget` before `fetch`; blocked attempts are logged and no OpenAI request is made. |
| Approval gate | `taskRequiresApproval` gates external contact and high estimated value; approvals require `APPROVE #<task_id> <nonce>` or `REJECT #<task_id> <nonce>`. |
| Webhook auth | Twilio, Retell, and Make routes reject invalid signatures/secrets before side effects. |
| Webhook idempotency | Twilio uses `MessageSid`; Make uses provider event/message/status IDs or stable payload hash; Retell uses event IDs/call IDs or stable payload hash. |
| Stale task recovery | Executor calls `recoverStaleInProgressTasks`; tasks below max attempts are requeued, tasks at the bound fail closed, and each action is logged. |
| SSRF protection | `fetchWithUrlSafety` blocks unsafe schemes, localhost, private/internal IPs, DNS failures, and redirects to unsafe destinations. |
| No real provider calls in tests | Provider boundaries are mocked or tested as pure helpers; route tests stop before outbound side effects. |

## Known Blockers

| Severity | Blocker | Recommendation |
|---|---|---|
| High | Live staging credentials have not been rotated or verified in this local run. | Rotate every credential listed in `docs/SECURITY_ROTATION_CHECKLIST.md` before deployment. |
| High | Supabase migration and seed were not applied to a real staging database during this local pass. | Apply migration/seed to staging and run the smoke test. |
| Medium | npm audit reports 2 moderate advisories in the installed dependency tree. | Review `npm audit` and upgrade safely if advisories affect reachable production paths. |
| Medium | Self-improver writes priority weights, but task claiming still orders by `priority_score`. | Wire weights into generation/scoring after staging safety validation. |
| Medium | Real supplier/buyer scanners remain limited to AusTender. | Add new scanners only after the staging safety cycle is proven. |
| Low | Staging smoke test depends on admin status metrics, not direct database reconciliation. | Add a read-only database reconciliation mode if staging access policy allows it. |

## Risk Table

| Risk | Current Mitigation | Residual Risk |
|---|---|---|
| Accidental outreach | Kill switch, external-contact config, compliance checks, approvals, daily limits. | Misconfigured staging data could still need review before disabling the kill switch. |
| Provider webhook replay | Signature/secret validation and `webhook_events` unique keys. | Provider payload fields should be monitored for format drift. |
| API spend overrun | Preflight reservation and daily cap. | Actual provider billing can differ from estimates; keep conservative cap in staging. |
| Stuck tasks | Lease-based stale recovery with bounded attempts. | Provider-specific long-running tasks may need tuned lease settings. |
| Unsafe research URL | DNS/IP/redirect SSRF guard. | DNS rebinding risk is reduced by validation before each fetch/redirect, but network egress policy is still recommended. |

## Go/No-Go Recommendation

Staging internal-only cycle: go, after applying migration/seed to a non-production Supabase project with rotated credentials and running `npm run smoke:staging`.

Production external outreach: no-go. Keep external contact disabled until staging evidence, consent/DNC import workflows, credential rotation, and reviewer sign-off are complete.
