export type TaskStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ActionType =
  | "outbound_call"
  | "send_email"
  | "send_sms"
  | "web_research"
  | "data_entry"
  | "opportunity_scan"
  | "briefing";

export type ExecutionOutcome = "success" | "failure" | "partial" | "pending";
export type ContactChannel = "call" | "sms" | "email";

export interface Goal {
  id: number;
  goal_text: string;
  status: "active" | "paused" | "completed" | "archived";
  sub_goals: string[];
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  goal_id: number | null;
  source: string;
  description: string;
  priority_score: number;
  status: TaskStatus;
  assigned_agent: string | null;
  action_type: ActionType;
  action_payload: Record<string, unknown>;
  result_summary: string | null;
  metadata: Record<string, unknown>;
  estimated_value: number;
  external_contact: boolean;
  approval_required: boolean;
  approval_nonce_hash: string | null;
  approval_expires_at: string | null;
  approval_used_at: string | null;
  approval_requested_at: string | null;
  attempt_count: number;
  max_attempts: number;
  idempotency_key: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Contact {
  id: number;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  source_url: string | null;
  consent_status: "unknown" | "express" | "inferred" | "none";
  consent_evidence: string | null;
  opted_out: boolean;
  opted_out_at: string | null;
  dnc_checked_at: string | null;
  dnc_status: "unknown" | "clear" | "registered" | "exempt" | "business_number";
  allowed_contact_channels: string[];
  timezone: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DailyMetrics {
  date: string;
  tasks_generated: number;
  tasks_completed: number;
  tasks_failed: number;
  calls_made: number;
  emails_sent: number;
  sms_sent: number;
  api_spend_cents: number;
  success_rate: number | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyChangeRequest {
  id: number;
  created_at: string;
  requested_by: string;
  request_source: string;
  request_text: string;
  risk_level: "low" | "medium" | "high" | "critical";
  protected_policy_keys: string[];
  proposed_change_summary: string;
  proposed_diff_or_config: Record<string, unknown>;
  status: "pending_review" | "approved" | "rejected" | "applied" | "expired";
  owner_approval_required: boolean;
  owner_approved_at: string | null;
  owner_approved_by: string | null;
  expires_at: string | null;
  applied_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  audit_metadata: Record<string, unknown>;
}

export interface GeneratedTask {
  goal_id?: number | null;
  source: string;
  description: string;
  priority_score: number;
  action_type: ActionType;
  action_payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  estimated_value?: number;
  external_contact?: boolean;
}

export interface WorkerResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}
