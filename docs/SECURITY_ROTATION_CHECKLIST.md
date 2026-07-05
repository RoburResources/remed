# Credential rotation checklist

Treat all credentials pasted into the previous chat/session as exposed.

## Rotate before deployment

- Supabase database password and API keys.
- Twilio auth token and any compromised console sessions.
- Retell API key and webhook verification key if separate.
- Vercel project/team sessions and environment variables.
- Google OAuth sessions used for Vercel/Make.com if exposed.
- Make.com webhooks and connected app tokens.
- Any OpenAI API key or service account key used in the project.

## After rotation

- Put secrets only in Vercel environment variables.
- Do not store service-role keys in browser-exposed variables.
- Keep `kill_switch_active=true` until webhook tests pass.
- Keep `external_contact_enabled=false` until contacts have consent/DNC/provenance records.
- Run a test cycle using internal-only tasks.
- Test Retell owner briefing only after confirming Retell from-number ownership.
