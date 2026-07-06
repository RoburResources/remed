import { sha256Hex } from "@/src/lib/crypto";
import { Task } from "@/src/lib/types";

export const EXTERNAL_CONTACT_REQUIRES_OWNER_APPROVAL = true;

type ChangeClassification = "normal_internal" | "external_contact" | "protected_policy";
type RiskLevel = "low" | "medium" | "high" | "critical";

interface PolicyChangeInput {
  key?: string;
  keys?: string[];
  value?: unknown;
  requestText?: string;
  source: string;
}

export class ProtectedPolicyChangeError extends Error {
  protectedPolicyKeys: string[];

  constructor(message: string, protectedPolicyKeys: string[]) {
    super(message);
    this.name = "ProtectedPolicyChangeError";
    this.protectedPolicyKeys = protectedPolicyKeys;
  }
}

const SAFE_CONFIG_LIMITS: Record<string, number> = {
  max_calls_per_day: 20,
  max_sms_per_day: 100,
  max_emails_per_day: 100,
  max_api_spend_cents_per_day: 5000
};

const PROTECTED_POLICY_KEYS = new Set([
  "external_contact_requires_owner_approval",
  "external_contact_enabled",
  "kill_switch_active",
  "approval_required",
  "approval_checks",
  "compliance_checks",
  "dnc_checks",
  "opt_out_handling",
  "webhook_verification",
  "webhook_idempotency",
  "stale_task_recovery",
  "ssrf_protection",
  "self_deployment_without_review",
  "protected_policy_code",
  ...Object.keys(SAFE_CONFIG_LIMITS)
]);

const POLICY_PATTERNS: Array<{ key: string; patterns: RegExp[] }> = [
  {
    key: "external_contact_requires_owner_approval",
    patterns: [
      /don't\s+need\s+my\s+permission\s+for\s+external\s+calls/i,
      /dont\s+need\s+my\s+permission\s+for\s+external\s+calls/i,
      /no\s+longer\s+need\s+(owner\s+)?approval/i,
      /turn\s+off\s+approval/i,
      /disable\s+approval/i,
      /remove\s+approval/i,
      /bypass\s+approval/i
    ]
  },
  {
    key: "compliance_checks",
    patterns: [/ignore\s+compliance/i, /remove\s+compliance/i, /disable\s+compliance/i, /compliance\s+gating/i]
  },
  {
    key: "dnc_checks",
    patterns: [/ignore\s+dnc/i, /disable\s+dnc/i, /remove\s+dnc/i, /do\s+not\s+call/i]
  },
  {
    key: "opt_out_handling",
    patterns: [/ignore\s+opt[-\s]?out/i, /disable\s+opt[-\s]?out/i, /unsubscribe\s+handling/i]
  },
  {
    key: "kill_switch_active",
    patterns: [/disable\s+the\s+kill\s+switch/i, /turn\s+off\s+the\s+kill\s+switch/i, /kill_switch_active\s*=\s*false/i]
  },
  {
    key: "external_contact_enabled",
    patterns: [/external_contact_enabled\s*=\s*true/i, /enable\s+external\s+contact/i, /enable\s+outreach/i]
  },
  {
    key: "max_calls_per_day",
    patterns: [/increase\s+the\s+call\s+limit/i, /call\s+limit\s+to\s+\d+/i, /1,?000\s+calls/i]
  },
  {
    key: "max_sms_per_day",
    patterns: [/increase\s+the\s+sms\s+limit/i, /sms\s+limit\s+to\s+\d+/i]
  },
  {
    key: "max_emails_per_day",
    patterns: [/increase\s+the\s+email\s+limit/i, /email\s+limit\s+to\s+\d+/i]
  },
  {
    key: "max_api_spend_cents_per_day",
    patterns: [/increase\s+.*api\s+spend/i, /api\s+spend\s+limit/i]
  },
  {
    key: "webhook_verification",
    patterns: [/disable\s+webhook\s+verification/i, /ignore\s+webhook\s+signatures?/i]
  },
  {
    key: "webhook_idempotency",
    patterns: [/disable\s+webhook\s+idempotency/i, /ignore\s+duplicate\s+webhooks/i]
  },
  {
    key: "stale_task_recovery",
    patterns: [/disable\s+stale\s+task\s+recovery/i]
  },
  {
    key: "ssrf_protection",
    patterns: [/disable\s+ssrf/i, /allow\s+localhost\s+fetch/i, /allow\s+private\s+ip/i]
  },
  {
    key: "self_deployment_without_review",
    patterns: [/deploy\s+yourself\s+without\s+review/i, /auto[-\s]?deploy\s+without\s+approval/i]
  },
  {
    key: "protected_policy_code",
    patterns: [/modify\s+protected\s+policy\s+code/i, /rewrite\s+safety\s+guards?/i]
  }
];

export function isProtectedPolicyKey(key: string): boolean {
  return PROTECTED_POLICY_KEYS.has(key);
}

export function getProtectedPolicyKeysFromText(text: string): string[] {
  const matched = new Set<string>();

  for (const entry of POLICY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      matched.add(entry.key);
    }
  }

  return [...matched].sort();
}

export function classifyChangeRequest(requestText: string): {
  classification: ChangeClassification;
  riskLevel: RiskLevel;
  protectedPolicyKeys: string[];
  summary: string;
} {
  const protectedPolicyKeys = getProtectedPolicyKeysFromText(requestText);
  if (protectedPolicyKeys.length > 0) {
    return {
      classification: "protected_policy",
      riskLevel: protectedPolicyKeys.includes("external_contact_requires_owner_approval") ? "critical" : "high",
      protectedPolicyKeys,
      summary: summarizeRequest(requestText, "Protected policy change proposal")
    };
  }

  if (isExternalContactRequestText(requestText)) {
    return {
      classification: "external_contact",
      riskLevel: "medium",
      protectedPolicyKeys: [],
      summary: summarizeRequest(requestText, "External-contact preparation request")
    };
  }

  return {
    classification: "normal_internal",
    riskLevel: "low",
    protectedPolicyKeys: [],
    summary: summarizeRequest(requestText, "Internal improvement request")
  };
}

export async function assertMayChangePolicy(input: PolicyChangeInput): Promise<void> {
  const keys = new Set<string>([...(input.keys ?? []), ...(input.key ? [input.key] : [])]);

  if (input.requestText) {
    for (const key of getProtectedPolicyKeysFromText(input.requestText)) {
      keys.add(key);
    }
  }

  const blocked = [...keys].filter((key) => {
    if (!isProtectedPolicyKey(key)) {
      return false;
    }

    if (input.key === key && isSafeProtectedConfigValue(key, input.value)) {
      return false;
    }

    return true;
  });

  if (blocked.length > 0) {
    throw new ProtectedPolicyChangeError(
      `Protected policy changes cannot be applied directly from ${input.source}`,
      blocked
    );
  }
}

export function isSafeProtectedConfigValue(key: string, value: unknown): boolean {
  if (key === "external_contact_requires_owner_approval") {
    return value === true;
  }

  if (key === "external_contact_enabled") {
    return value === false;
  }

  if (key === "kill_switch_active") {
    return value === true;
  }

  if (key in SAFE_CONFIG_LIMITS) {
    return typeof value === "number" && Number.isFinite(value) && value <= SAFE_CONFIG_LIMITS[key];
  }

  return false;
}

export function assertExternalContactOwnerApproval(task: Task): void {
  if (!EXTERNAL_CONTACT_REQUIRES_OWNER_APPROVAL) {
    throw new ProtectedPolicyChangeError("External contact owner approval invariant was disabled", [
      "external_contact_requires_owner_approval"
    ]);
  }

  if (!hasTaskSpecificOwnerApproval(task)) {
    throw new Error("External contact blocked: specific owner approval is required for this task");
  }
}

export function hasTaskSpecificOwnerApproval(task: Task): boolean {
  return Boolean(task.approval_required && task.approval_used_at && !task.approval_nonce_hash);
}

export function isExternalContactActionType(actionType: string): boolean {
  return actionType === "outbound_call" || actionType === "send_sms" || actionType === "send_email";
}

export function isOwnerPhoneTaskTarget(task: Task, ownerPhone: string): boolean {
  const value = task.action_payload.to_number ?? task.action_payload.phone;
  return typeof value === "string" && value === ownerPhone;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/(secret|token|password|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

export function stablePolicyRequestHash(value: string): string {
  return sha256Hex(redactSensitiveText(value).trim().toLowerCase());
}

function isExternalContactRequestText(text: string): boolean {
  return /\b(call|calls|sms|text|email|whatsapp|message|contact|outreach)\b/i.test(text);
}

function summarizeRequest(text: string, prefix: string): string {
  const redacted = redactSensitiveText(text).replace(/\s+/g, " ").trim();
  return `${prefix}: ${redacted.slice(0, 220)}`;
}
