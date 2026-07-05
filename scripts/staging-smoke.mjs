const required = ["STAGING_BASE_URL", "CRON_SECRET", "DASHBOARD_API_TOKEN", "STAGING_CONFIRM_NON_PRODUCTION"];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

if (process.env.STAGING_CONFIRM_NON_PRODUCTION !== "true") {
  throw new Error("Set STAGING_CONFIRM_NON_PRODUCTION=true to confirm this is not production.");
}

const baseUrl = new URL(process.env.STAGING_BASE_URL);
if (baseUrl.hostname === "robur.com.au" || baseUrl.hostname.startsWith("www.")) {
  throw new Error("Refusing to run smoke test against a production-looking hostname.");
}

const cronHeaders = {
  Authorization: `Bearer ${process.env.CRON_SECRET}`
};
const dashboardHeaders = {
  Authorization: `Bearer ${process.env.DASHBOARD_API_TOKEN}`
};

const before = await getStatus();
assertSafeDefaults(before, "before cron calls");

const generator = await callEndpoint("/api/cron/task-generator", cronHeaders);
const executor = await callEndpoint("/api/cron/task-executor", cronHeaders);

const after = await getStatus();
assertSafeDefaults(after, "after cron calls");
assertNoExternalOutreach(before, after);

console.log(JSON.stringify({
  ok: true,
  base_url: baseUrl.origin,
  generator,
  executor,
  safety: {
    kill_switch_active: after.kill_switch_active,
    external_contact_enabled: after.external_contact_enabled
  },
  reconciliation: {
    before: summarizeMetrics(before.daily_metrics),
    after: summarizeMetrics(after.daily_metrics)
  }
}, null, 2));

async function getStatus() {
  return callEndpoint("/api/admin/status", dashboardHeaders);
}

async function callEndpoint(path, headers) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "GET",
    headers,
    redirect: "manual"
  });
  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

function assertSafeDefaults(status, label) {
  if (status.kill_switch_active !== true && status.external_contact_enabled !== false) {
    throw new Error(`Unsafe staging state ${label}: kill switch is off and external contact is enabled.`);
  }
}

function assertNoExternalOutreach(before, after) {
  const beforeMetrics = summarizeMetrics(before.daily_metrics);
  const afterMetrics = summarizeMetrics(after.daily_metrics);

  for (const metric of ["calls_made", "emails_sent", "sms_sent"]) {
    if (afterMetrics[metric] > beforeMetrics[metric]) {
      throw new Error(`External outreach metric increased during smoke test: ${metric}`);
    }
  }
}

function summarizeMetrics(metrics = {}) {
  return {
    tasks_generated: Number(metrics.tasks_generated ?? 0),
    tasks_completed: Number(metrics.tasks_completed ?? 0),
    tasks_failed: Number(metrics.tasks_failed ?? 0),
    calls_made: Number(metrics.calls_made ?? 0),
    emails_sent: Number(metrics.emails_sent ?? 0),
    sms_sent: Number(metrics.sms_sent ?? 0),
    api_spend_cents: Number(metrics.api_spend_cents ?? 0)
  };
}
