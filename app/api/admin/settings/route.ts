import { NextRequest } from "next/server";
import { getConfig, logExecution, setConfig } from "@/src/lib/db";
import { getEnv, hasRetellCredentials, hasRetellWebCallCredentials } from "@/src/lib/env";
import { requireDashboardAuth, withRouteErrors } from "@/src/lib/http";

export const dynamic = "force-dynamic";

const LIMITS = {
  max_calls_per_day: 20,
  max_sms_per_day: 100,
  max_emails_per_day: 100,
  max_api_spend_cents_per_day: 5000
} as const;

type LimitKey = keyof typeof LIMITS;

export async function GET(request: NextRequest) {
  return withRouteErrors(async () => {
    requireDashboardAuth(request);
    return readSettings();
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrors(async () => {
    requireDashboardAuth(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updated: string[] = [];

    if (typeof body.retell_briefings_enabled === "boolean") {
      await setConfig(
        "retell_briefings_enabled",
        body.retell_briefings_enabled,
        "Dashboard setting for owner voice briefing calls."
      );
      updated.push("retell_briefings_enabled");
    }

    for (const key of Object.keys(LIMITS) as LimitKey[]) {
      if (body[key] === undefined) continue;
      const value = boundedInteger(body[key], 1, LIMITS[key], key);
      await setConfig(key, value, `Dashboard setting capped at ${LIMITS[key]}.`);
      updated.push(key);
    }

    if (updated.length > 0) {
      await logExecution({
        actionType: "admin_settings_updated",
        details: { updated },
        outcome: "success"
      });
    }

    return {
      ...(await readSettings()),
      updated
    };
  });
}

async function readSettings() {
  const env = getEnv();
  const [retellBriefingsEnabled, maxCalls, maxSms, maxEmails, maxApiSpend] = await Promise.all([
    getConfig<boolean>("retell_briefings_enabled", true),
    getConfig<number>("max_calls_per_day", LIMITS.max_calls_per_day),
    getConfig<number>("max_sms_per_day", LIMITS.max_sms_per_day),
    getConfig<number>("max_emails_per_day", LIMITS.max_emails_per_day),
    getConfig<number>("max_api_spend_cents_per_day", LIMITS.max_api_spend_cents_per_day)
  ]);

  return {
    ok: true,
    voice: {
      retell_configured: hasRetellCredentials(env),
      retell_web_call_configured: hasRetellWebCallCredentials(env),
      retell_briefings_enabled: retellBriefingsEnabled,
      owner_phone_configured: Boolean(env.OWNER_PHONE),
      owner_email_configured: Boolean(env.OWNER_EMAIL),
      owner_contact_rule: "Owner phone calls/SMS and owner email can run without per-task approval."
    },
    limits: {
      max_calls_per_day: maxCalls,
      max_sms_per_day: maxSms,
      max_emails_per_day: maxEmails,
      max_api_spend_cents_per_day: maxApiSpend
    },
    bounds: LIMITS
  };
}

function boundedInteger(value: unknown, min: number, max: number, key: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw Object.assign(new Error(`${key} must be an integer from ${min} to ${max}`), { status: 400 });
  }
  return numberValue;
}
