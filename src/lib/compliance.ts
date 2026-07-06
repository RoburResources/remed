import { getConfig, getContactById, recordComplianceEvent } from "@/src/lib/db";
import { getEnv } from "@/src/lib/env";
import { assertExternalContactOwnerApproval } from "@/src/lib/policy";
import { ContactChannel, Task } from "@/src/lib/types";

interface ComplianceDecision {
  allowed: boolean;
  reason?: string;
}

function getPayloadNumber(task: Task, key: string): number | null {
  const value = task.action_payload[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function getPayloadString(task: Task, key: string): string | null {
  const value = task.action_payload[key];
  return typeof value === "string" ? value : null;
}

function getPartsForTimezone(date: Date, timezone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function isPermittedTelemarketingWindow(
  date: Date,
  timezone = "Australia/Perth",
  publicHolidayDates: string[] = []
): boolean {
  const parts = getPartsForTimezone(date, timezone);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const minute = Number(parts.minute);
  const minutes = hour * 60 + minute;

  if (publicHolidayDates.includes(localDate)) {
    return false;
  }

  if (parts.weekday === "Sun") {
    return false;
  }

  if (parts.weekday === "Sat") {
    return minutes >= 9 * 60 && minutes < 17 * 60;
  }

  return minutes >= 9 * 60 && minutes < 20 * 60;
}

export async function assertExternalContactAllowed(task: Task, channel: ContactChannel): Promise<void> {
  const env = getEnv();
  const enabled = await getConfig<boolean>("external_contact_enabled", false);

  const targetPhone = getPayloadString(task, "to_number") ?? getPayloadString(task, "phone");
  const targetEmail = getPayloadString(task, "to_email") ?? getPayloadString(task, "email");

  if ((channel === "call" || channel === "sms") && targetPhone === env.OWNER_PHONE) {
    return;
  }

  if (!enabled) {
    throw new Error("External contact disabled by system_config.external_contact_enabled");
  }

  assertExternalContactOwnerApproval(task);

  const contactId = getPayloadNumber(task, "contact_id");
  if (!contactId) {
    throw new Error("External contact blocked: task action_payload.contact_id is required");
  }

  const decision = await checkContactPermission(contactId, channel, task.id, targetPhone, targetEmail);
  if (!decision.allowed) {
    throw new Error(`External contact blocked: ${decision.reason}`);
  }
}

export async function checkContactPermission(
  contactId: number,
  channel: ContactChannel,
  taskId?: number,
  targetPhone?: string | null,
  targetEmail?: string | null
): Promise<ComplianceDecision> {
  const contact = await getContactById(contactId);

  if (!contact) {
    return { allowed: false, reason: "contact not found" };
  }

  if (contact.opted_out) {
    await recordComplianceEvent({
      contactId,
      taskId,
      eventType: "blocked_opted_out",
      channel,
      evidence: { opted_out_at: contact.opted_out_at }
    });
    return { allowed: false, reason: "contact has opted out" };
  }

  if (!contact.allowed_contact_channels.includes(channel)) {
    return { allowed: false, reason: `channel ${channel} is not allowed for contact` };
  }

  if (channel === "email" || channel === "sms") {
    if (!["express", "inferred"].includes(contact.consent_status)) {
      return { allowed: false, reason: "commercial electronic message requires express or inferred consent" };
    }
  }

  if (channel === "email" && targetEmail && contact.email && targetEmail.toLowerCase() !== contact.email.toLowerCase()) {
    return { allowed: false, reason: "target email does not match compliance contact" };
  }

  if ((channel === "sms" || channel === "call") && targetPhone && contact.phone && targetPhone !== contact.phone) {
    return { allowed: false, reason: "target phone does not match compliance contact" };
  }

  if (channel === "call") {
    if (contact.dnc_status === "registered" && contact.consent_status !== "express") {
      return { allowed: false, reason: "number is registered on DNC without express consent/exemption" };
    }

    const publicHolidays = await getConfig<string[]>("public_holidays_awst", []);
    if (!isPermittedTelemarketingWindow(new Date(), contact.timezone, publicHolidays)) {
      return { allowed: false, reason: "outside permitted telemarketing contact hours" };
    }
  }

  await recordComplianceEvent({
    contactId,
    taskId,
    eventType: "contact_permission_passed",
    channel,
    evidence: {
      consent_status: contact.consent_status,
      dnc_status: contact.dnc_status,
      allowed_contact_channels: contact.allowed_contact_channels
    }
  });

  return { allowed: true };
}
