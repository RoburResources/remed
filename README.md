# Robur Autonomous Worker — Codex Remediation Build

This package replaces the audited Manus/Vite/Express prototype with a Vercel + Supabase + Next.js worker implementation that Codex can safely continue.

## What changed

- Supabase Postgres migration replaces MySQL Drizzle.
- Vercel cron endpoints are `GET` route handlers protected by `CRON_SECRET`.
- Dashboard/admin APIs require `DASHBOARD_API_TOKEN`.
- Retell outbound calls use `POST /v2/create-phone-call` with `from_number`, `to_number`, and documented one-time `override_agent_id`.
- Retell webhooks verify `X-Retell-Signature` against the raw body before updating call/task state.
- Twilio inbound SMS verifies `X-Twilio-Signature`, uses canonical deployment URL, and restricts control commands to `OWNER_PHONE`.
- Approval commands are task-specific and nonce-specific: `APPROVE #123 184921`.
- Queue claiming uses Postgres `FOR UPDATE SKIP LOCKED` through `claim_next_task`.
- External contact is blocked unless compliance ledger conditions pass.
- STOP/UNSUBSCRIBE replies are recorded to the opt-out ledger.
- Daily call/email/SMS/API-spend limits are enforced before execution.
- Evaluations are written only after completed provider outcomes exist.

## First production actions

1. Rotate every credential exposed in any chat/session.
2. Create a fresh Supabase project or wipe the old prototype tables.
3. Apply `supabase/migrations/0001_robur_autonomous_worker.sql`.
4. Apply `supabase/seed.sql`.
5. Deploy this repository to Vercel.
6. Set all environment variables from `.env.example`.
7. Configure Twilio inbound SMS webhook:
   - `POST https://<deployment>/api/webhooks/twilio/sms`
8. Configure Retell call event webhook:
   - `POST https://<deployment>/api/webhooks/retell`
9. Configure Make.com email callback webhook if email is enabled:
   - `POST https://<deployment>/api/webhooks/make/email`
   - Header: `x-robur-webhook-secret: $MAKE_WEBHOOK_SECRET`
10. Run `npm run check`.
11. Manually invoke `/api/admin/status` with `Authorization: Bearer $DASHBOARD_API_TOKEN`.

## Safety default

This build is safe-by-default. It does not contact external people unless:
- kill switch is off,
- daily limits are below cap,
- contact has required consent/provenance,
- DNC/contact-hour checks pass,
- high-value actions have a valid owner approval nonce,
- the provider call/message succeeds.

Owner briefings to `OWNER_PHONE` are separate from marketing/outreach and are still counted against the call limit.
