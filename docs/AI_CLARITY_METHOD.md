# AI Clarity Method — Robur remediation brief

## Intent

Build a safe, production-ready Robur Autonomous Worker that can generate, execute, evaluate, and improve tasks without uncontrolled external outreach.

## Current reality

The audited repository was a prototype. It did not implement the requested Supabase/Vercel/Retell/Twilio safety architecture and should not contact external people.

## Constraints

- Perth, WA business context.
- Vercel cron invokes production URLs with GET.
- Supabase is the system of record.
- Retell is the only outbound voice path.
- Twilio inbound webhooks must be signed and owner-gated.
- Australian commercial electronic messaging and telemarketing rules must be enforced before outreach.
- Secrets exposed in chat must be rotated before deployment.

## Rebuild decision

Use a clean Next.js/Vercel worker instead of trying to harden the Manus/Vite/Express prototype in place.

## Acceptance criteria

- Cron routes protected.
- Dashboard routes protected.
- Queue claims locked.
- Approval task ID + nonce required.
- Provider webhooks signed and idempotent.
- External contact blocked without compliance ledger proof.
- Audit trail written for every action.
- Evaluation loop writes durable results.
- Kill switch defaults to on.

## Default launch posture

Deploy with `kill_switch_active=true` and `external_contact_enabled=false`. Only enable live execution after rotated credentials, signed webhooks, and test cycles pass.
