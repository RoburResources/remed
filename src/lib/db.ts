import { supabaseAdmin } from "@/src/lib/supabase";
import { DailyMetrics, ExecutionOutcome, GeneratedTask, Goal, Task, Contact } from "@/src/lib/types";
import { idempotencyKey } from "@/src/lib/crypto";

type JsonRecord = Record<string, unknown>;

function throwIfError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await supabaseAdmin()
    .from("system_config")
    .select("config_value")
    .eq("config_key", key)
    .maybeSingle();

  throwIfError(error, `getConfig(${key})`);
  return (data?.config_value as T | undefined) ?? fallback;
}

export async function setConfig(key: string, value: unknown, description?: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("system_config")
    .upsert(
      {
        config_key: key,
        config_value: value,
        description
      },
      { onConflict: "config_key" }
    );

  throwIfError(error, `setConfig(${key})`);
}

export async function isKillSwitchActive(): Promise<boolean> {
  return getConfig<boolean>("kill_switch_active", true);
}

export async function logExecution(input: {
  taskId?: number;
  actionType: string;
  details?: JsonRecord;
  outcome?: ExecutionOutcome;
  errorMessage?: string;
  durationMs?: number;
  tokensCost?: number;
  apiSpendCents?: number;
}): Promise<void> {
  const { error } = await supabaseAdmin().from("execution_log").insert({
    task_id: input.taskId ?? null,
    action_type: input.actionType,
    details: input.details ?? {},
    outcome: input.outcome ?? "pending",
    error_message: input.errorMessage ?? null,
    duration_ms: input.durationMs ?? null,
    tokens_cost: input.tokensCost ?? null,
    api_spend_cents: input.apiSpendCents ?? 0
  });

  throwIfError(error, "logExecution");
}

export async function incrementDailyMetric(
  metric:
    | "tasks_generated"
    | "tasks_completed"
    | "tasks_failed"
    | "calls_made"
    | "emails_sent"
    | "sms_sent"
    | "api_spend_cents",
  amount = 1
): Promise<void> {
  const { error } = await supabaseAdmin().rpc("increment_daily_metric", {
    metric_name: metric,
    amount
  });

  throwIfError(error, `incrementDailyMetric(${metric})`);
}

export async function getTodayMetrics(): Promise<DailyMetrics> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin()
    .from("daily_metrics")
    .select("*")
    .eq("date", today)
    .maybeSingle();

  throwIfError(error, "getTodayMetrics");

  if (data) {
    return data as DailyMetrics;
  }

  const { data: inserted, error: insertError } = await supabaseAdmin()
    .from("daily_metrics")
    .insert({ date: today })
    .select("*")
    .single();

  throwIfError(insertError, "createTodayMetrics");
  if (!inserted) {
    throw new Error("createTodayMetrics: no row returned");
  }
  return inserted as DailyMetrics;
}

export async function assertDailyLimit(metric: keyof Pick<DailyMetrics, "calls_made" | "emails_sent" | "sms_sent" | "api_spend_cents">, maxConfigKey: string): Promise<void> {
  const metrics = await getTodayMetrics();
  const max = await getConfig<number>(maxConfigKey, 0);
  const current = Number(metrics[metric] ?? 0);

  if (max <= 0) {
    throw new Error(`Invalid daily limit config: ${maxConfigKey}`);
  }

  if (current >= max) {
    throw new Error(`Daily limit reached for ${metric}: ${current}/${max}`);
  }
}

export function wouldExceedDailyApiSpend(currentSpendCents: number, maxSpendCents: number, estimatedSpendCents: number): boolean {
  if (maxSpendCents <= 0 || estimatedSpendCents <= 0) {
    return true;
  }

  return currentSpendCents + estimatedSpendCents > maxSpendCents;
}

export async function reserveApiSpendBudget(input: {
  taskId?: number;
  estimatedSpendCents: number;
  actionType: string;
  details?: JsonRecord;
}): Promise<{ reservedSpendCents: number; currentSpendCents: number; maxSpendCents: number }> {
  const estimatedSpendCents = Math.max(1, Math.ceil(input.estimatedSpendCents));
  const [metrics, maxSpendCents] = await Promise.all([
    getTodayMetrics(),
    getConfig<number>("max_api_spend_cents_per_day", 0)
  ]);
  const currentSpendCents = Number(metrics.api_spend_cents ?? 0);

  if (wouldExceedDailyApiSpend(currentSpendCents, maxSpendCents, estimatedSpendCents)) {
    await logExecution({
      taskId: input.taskId,
      actionType: `${input.actionType}_blocked_api_spend_cap`,
      details: {
        ...(input.details ?? {}),
        current_spend_cents: currentSpendCents,
        estimated_spend_cents: estimatedSpendCents,
        max_spend_cents: maxSpendCents
      },
      outcome: "failure",
      errorMessage: "OpenAI daily spend cap would be exceeded"
    });
    throw new Error(
      `OpenAI daily spend cap would be exceeded: ${currentSpendCents}+${estimatedSpendCents}/${maxSpendCents} cents`
    );
  }

  await incrementDailyMetric("api_spend_cents", estimatedSpendCents);
  await logExecution({
    taskId: input.taskId,
    actionType: `${input.actionType}_api_spend_reserved`,
    details: {
      ...(input.details ?? {}),
      previous_spend_cents: currentSpendCents,
      reserved_spend_cents: estimatedSpendCents,
      max_spend_cents: maxSpendCents
    },
    outcome: "pending",
    apiSpendCents: estimatedSpendCents
  });

  return {
    reservedSpendCents: estimatedSpendCents,
    currentSpendCents,
    maxSpendCents
  };
}

export async function reconcileReservedApiSpend(input: {
  taskId?: number;
  reservedSpendCents: number;
  actualSpendCents: number;
  actionType: string;
  details?: JsonRecord;
}): Promise<void> {
  const delta = Math.ceil(input.actualSpendCents) - Math.ceil(input.reservedSpendCents);
  if (delta !== 0) {
    await incrementDailyMetric("api_spend_cents", delta);
  }

  await logExecution({
    taskId: input.taskId,
    actionType: `${input.actionType}_api_spend_reconciled`,
    details: {
      ...(input.details ?? {}),
      reserved_spend_cents: input.reservedSpendCents,
      actual_spend_cents: input.actualSpendCents,
      adjustment_cents: delta
    },
    outcome: "success",
    apiSpendCents: input.actualSpendCents
  });
}

export async function getActiveGoals(): Promise<Goal[]> {
  const { data, error } = await supabaseAdmin()
    .from("goals")
    .select("*")
    .eq("status", "active")
    .order("priority", { ascending: false });

  throwIfError(error, "getActiveGoals");
  return (data ?? []) as Goal[];
}

export async function getRecentTasks(limit = 100): Promise<Task[]> {
  const { data, error } = await supabaseAdmin()
    .from("task_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfError(error, "getRecentTasks");
  return (data ?? []) as Task[];
}

export async function getTasksByStatus(status: Task["status"], limit = 50): Promise<Task[]> {
  const { data, error } = await supabaseAdmin()
    .from("task_queue")
    .select("*")
    .eq("status", status)
    .order("priority_score", { ascending: false })
    .limit(limit);

  throwIfError(error, `getTasksByStatus(${status})`);
  return (data ?? []) as Task[];
}

export async function createTasks(tasks: GeneratedTask[]): Promise<number> {
  if (tasks.length === 0) return 0;

  const rows = tasks.map((task) => ({
    goal_id: task.goal_id ?? null,
    source: task.source || "task_generator",
    description: task.description,
    priority_score: task.priority_score,
    action_type: task.action_type,
    action_payload: task.action_payload ?? {},
    metadata: task.metadata ?? {},
    estimated_value: task.estimated_value ?? 0,
    external_contact: task.external_contact ?? false,
    approval_required: false,
    attempt_count: 0,
    status: "pending",
    idempotency_key: idempotencyKey([
      task.source || "task_generator",
      task.goal_id ?? "none",
      task.action_type,
      task.description.toLowerCase().trim()
    ])
  }));

  const { data, error } = await supabaseAdmin()
    .from("task_queue")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id");

  throwIfError(error, "createTasks");

  const created = data?.length ?? 0;
  if (created > 0) {
    await incrementDailyMetric("tasks_generated", created);
  }

  return created;
}

export type StaleTaskRecoveryAction = "requeued" | "failed";

export function decideStaleTaskRecovery(attemptCount: number, maxAttempts: number): StaleTaskRecoveryAction {
  return attemptCount + 1 >= maxAttempts ? "failed" : "requeued";
}

export async function expireOldApprovals(): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("expire_old_approvals");
  throwIfError(error, "expireOldApprovals");

  const expired = Number(data ?? 0);
  if (expired > 0) {
    await logExecution({
      actionType: "approval_expiry_cleanup",
      details: { approvals_expired: expired },
      outcome: "success"
    });
  }

  return expired;
}

export async function recoverStaleInProgressTasks(): Promise<Array<{
  task_id: number;
  action: StaleTaskRecoveryAction;
  attempt_count: number;
  max_attempts: number;
}>> {
  const [staleAfterSeconds, defaultMaxAttempts] = await Promise.all([
    getConfig<number>("stale_task_lease_seconds", 1800),
    getConfig<number>("max_task_attempts", 3)
  ]);

  const { data, error } = await supabaseAdmin().rpc("recover_stale_in_progress_tasks", {
    stale_after_seconds: staleAfterSeconds,
    default_max_attempts: defaultMaxAttempts
  });

  throwIfError(error, "recoverStaleInProgressTasks");

  const recovered = ((data ?? []) as Array<{
    task_id: number;
    action: StaleTaskRecoveryAction;
    attempt_count: number;
    max_attempts: number;
  }>);

  if (recovered.length > 0) {
    await logExecution({
      actionType: "stale_task_recovery_summary",
      details: {
        recovered_count: recovered.length,
        requeued_count: recovered.filter((item) => item.action === "requeued").length,
        failed_count: recovered.filter((item) => item.action === "failed").length
      },
      outcome: "success"
    });
  }

  return recovered;
}

export async function claimNextTask(workerId: string, leaseSeconds = 900): Promise<Task | null> {
  const { data, error } = await supabaseAdmin()
    .rpc("claim_next_task", {
      worker_id: workerId,
      lease_seconds: leaseSeconds
    })
    .maybeSingle();

  throwIfError(error, "claimNextTask");
  return (data as Task | null) ?? null;
}

export async function updateTask(taskId: number, update: Partial<Task>): Promise<Task> {
  const { data, error } = await supabaseAdmin()
    .from("task_queue")
    .update(update)
    .eq("id", taskId)
    .select("*")
    .single();

  throwIfError(error, `updateTask(${taskId})`);
  return data as Task;
}

export async function completeTask(taskId: number, resultSummary: string, metadata?: JsonRecord): Promise<void> {
  const update: Partial<Task> = {
    status: "completed",
    result_summary: resultSummary,
    completed_at: new Date().toISOString(),
    lease_expires_at: null,
    metadata: metadata ?? undefined
  };

  const { error } = await supabaseAdmin().from("task_queue").update(update).eq("id", taskId);
  throwIfError(error, `completeTask(${taskId})`);
  await incrementDailyMetric("tasks_completed");
}

export async function failTask(taskId: number, errorMessage: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("task_queue")
    .update({
      status: "failed",
      result_summary: errorMessage,
      lease_expires_at: null
    })
    .eq("id", taskId);

  throwIfError(error, `failTask(${taskId})`);
  await incrementDailyMetric("tasks_failed");
}

export async function getContactById(contactId: number): Promise<Contact | null> {
  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();

  throwIfError(error, `getContactById(${contactId})`);
  return (data as Contact | null) ?? null;
}

export async function findContactByPhone(phone: string): Promise<Contact | null> {
  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  throwIfError(error, `findContactByPhone(${phone})`);
  return (data as Contact | null) ?? null;
}

export async function recordComplianceEvent(input: {
  contactId?: number | null;
  taskId?: number | null;
  eventType: string;
  channel?: string | null;
  evidence?: JsonRecord;
}): Promise<void> {
  const { error } = await supabaseAdmin().from("compliance_events").insert({
    contact_id: input.contactId ?? null,
    task_id: input.taskId ?? null,
    event_type: input.eventType,
    channel: input.channel ?? null,
    evidence: input.evidence ?? {}
  });

  throwIfError(error, "recordComplianceEvent");
}

export async function recordOptOutByPhone(phone: string, evidence: JsonRecord): Promise<void> {
  const contact = await findContactByPhone(phone);

  if (contact) {
    const { error } = await supabaseAdmin()
      .from("contacts")
      .update({
        opted_out: true,
        opted_out_at: new Date().toISOString()
      })
      .eq("id", contact.id);

    throwIfError(error, `recordOptOutByPhone(${phone})`);

    await recordComplianceEvent({
      contactId: contact.id,
      eventType: "opt_out",
      channel: "sms",
      evidence
    });
    return;
  }

  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .insert({
      phone,
      source: "inbound_sms",
      consent_status: "none",
      opted_out: true,
      opted_out_at: new Date().toISOString(),
      metadata: { created_from: "opt_out" }
    })
    .select("id")
    .single();

  throwIfError(error, `createOptOutContact(${phone})`);
  if (!data) {
    throw new Error(`createOptOutContact(${phone}): no row returned`);
  }

  await recordComplianceEvent({
    contactId: Number(data.id),
    eventType: "opt_out",
    channel: "sms",
    evidence
  });
}

export async function upsertOpportunity(input: {
  source: string;
  sourceUrl?: string | null;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  estimatedValue?: number | null;
  metadata?: JsonRecord;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("opportunities")
    .upsert(
      {
        source: input.source,
        source_url: input.sourceUrl ?? null,
        description: input.description,
        priority: input.priority,
        estimated_value: input.estimatedValue ?? null,
        metadata: input.metadata ?? {}
      },
      { onConflict: "source,source_url", ignoreDuplicates: true }
    )
    .select("id");

  throwIfError(error, "upsertOpportunity");
  return (data?.length ?? 0) > 0;
}


export async function recordOutboundMessage(input: {
  taskId?: number | null;
  contactId?: number | null;
  channel: "sms" | "email";
  provider: string;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  fromAddress?: string | null;
  toAddress: string;
  subject?: string | null;
  bodyHash?: string | null;
  metadata?: JsonRecord;
}): Promise<void> {
  const { error } = await supabaseAdmin().from("outbound_messages").insert({
    task_id: input.taskId ?? null,
    contact_id: input.contactId ?? null,
    channel: input.channel,
    provider: input.provider,
    provider_message_id: input.providerMessageId ?? null,
    provider_status: input.providerStatus ?? null,
    from_address: input.fromAddress ?? null,
    to_address: input.toAddress,
    subject: input.subject ?? null,
    body_hash: input.bodyHash ?? null,
    metadata: input.metadata ?? {}
  });

  throwIfError(error, "recordOutboundMessage");
}


export async function recordRetellCall(input: {
  taskId?: number | null;
  contactId?: number | null;
  callId: string;
  eventStatus: string;
  fromNumber: string;
  toNumber: string;
  agentId?: string | null;
  metadata?: JsonRecord;
}): Promise<void> {
  const { error } = await supabaseAdmin().from("retell_calls").upsert(
    {
      task_id: input.taskId ?? null,
      contact_id: input.contactId ?? null,
      call_id: input.callId,
      event_status: input.eventStatus,
      from_number: input.fromNumber,
      to_number: input.toNumber,
      agent_id: input.agentId ?? null,
      metadata: input.metadata ?? {}
    },
    { onConflict: "call_id" }
  );

  throwIfError(error, "recordRetellCall");
}

export async function updateRetellCallByCallId(input: {
  callId: string;
  eventStatus: string;
  transcript?: string | null;
  callAnalysis?: JsonRecord | null;
  endedAt?: string | null;
  metadata?: JsonRecord;
}): Promise<{ taskId: number | null }> {
  const { data, error } = await supabaseAdmin()
    .from("retell_calls")
    .update({
      event_status: input.eventStatus,
      transcript: input.transcript ?? undefined,
      call_analysis: input.callAnalysis ?? undefined,
      ended_at: input.endedAt ?? undefined,
      metadata: input.metadata ?? undefined
    })
    .eq("call_id", input.callId)
    .select("task_id")
    .maybeSingle();

  throwIfError(error, "updateRetellCallByCallId");
  return { taskId: (data?.task_id as number | null | undefined) ?? null };
}

export async function recordWebhookEvent(input: {
  provider: string;
  eventId: string;
  signatureValid: boolean;
  payload: JsonRecord;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("webhook_events")
    .upsert(
      {
        provider: input.provider,
        event_id: input.eventId,
        signature_valid: input.signatureValid,
        payload: input.payload,
        processed_at: new Date().toISOString()
      },
      { onConflict: "provider,event_id", ignoreDuplicates: true }
    )
    .select("id");

  throwIfError(error, "recordWebhookEvent");
  return (data?.length ?? 0) > 0;
}


export async function getRecentOpportunities(limit = 20): Promise<Array<{
  id: number;
  source: string;
  source_url: string | null;
  description: string;
  priority: string;
  status: string;
  detected_at: string;
}>> {
  const { data, error } = await supabaseAdmin()
    .from("opportunities")
    .select("id, source, source_url, description, priority, status, detected_at")
    .order("detected_at", { ascending: false })
    .limit(limit);

  throwIfError(error, "getRecentOpportunities");
  return data ?? [];
}

export async function getCompletedTasksWithoutEvaluation(limit = 50): Promise<Task[]> {
  const { data, error } = await supabaseAdmin()
    .from("task_queue")
    .select("*, evaluations!left(id)")
    .eq("status", "completed")
    .is("evaluations.id", null)
    .order("completed_at", { ascending: false })
    .limit(limit);

  throwIfError(error, "getCompletedTasksWithoutEvaluation");
  return (data ?? []).map((row: Task & { evaluations?: unknown }) => {
    const { evaluations: _evaluations, ...task } = row;
    return task as Task;
  });
}

export async function createEvaluation(input: {
  taskId: number;
  success: "true" | "false" | "partial";
  conversionRate?: number | null;
  costTokens?: number | null;
  costCents?: number;
  lessonLearned?: string | null;
  strategyUsed?: string | null;
  improvementSuggestion?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin().from("evaluations").upsert(
    {
      task_id: input.taskId,
      success: input.success,
      conversion_rate: input.conversionRate ?? null,
      cost_tokens: input.costTokens ?? null,
      cost_cents: input.costCents ?? 0,
      lesson_learned: input.lessonLearned ?? null,
      strategy_used: input.strategyUsed ?? null,
      improvement_suggestion: input.improvementSuggestion ?? null
    },
    { onConflict: "task_id" }
  );

  throwIfError(error, "createEvaluation");
}

export async function getRecentEvaluations(limit = 50): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin()
    .from("evaluations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfError(error, "getRecentEvaluations");
  return data ?? [];
}


export async function completeTaskIfOpen(taskId: number, resultSummary: string, metadata?: JsonRecord): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("task_queue")
    .update({
      status: "completed",
      result_summary: resultSummary,
      metadata: metadata ?? undefined,
      completed_at: new Date().toISOString(),
      lease_expires_at: null
    })
    .eq("id", taskId)
    .neq("status", "completed")
    .select("id")
    .maybeSingle();

  throwIfError(error, `completeTaskIfOpen(${taskId})`);

  if (data) {
    await incrementDailyMetric("tasks_completed");
    return true;
  }

  return false;
}


export async function findContactByEmail(email: string): Promise<Contact | null> {
  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  throwIfError(error, `findContactByEmail(${email})`);
  return (data as Contact | null) ?? null;
}

export async function recordOptOutByEmail(email: string, evidence: JsonRecord): Promise<void> {
  const contact = await findContactByEmail(email);

  if (contact) {
    const { error } = await supabaseAdmin()
      .from("contacts")
      .update({
        opted_out: true,
        opted_out_at: new Date().toISOString()
      })
      .eq("id", contact.id);

    throwIfError(error, `recordOptOutByEmail(${email})`);

    await recordComplianceEvent({
      contactId: contact.id,
      eventType: "opt_out",
      channel: "email",
      evidence
    });
    return;
  }

  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .insert({
      email,
      source: "email_webhook",
      consent_status: "none",
      opted_out: true,
      opted_out_at: new Date().toISOString(),
      metadata: { created_from: "email_opt_out" }
    })
    .select("id")
    .single();

  throwIfError(error, `createEmailOptOutContact(${email})`);
  if (!data) {
    throw new Error(`createEmailOptOutContact(${email}): no row returned`);
  }

  await recordComplianceEvent({
    contactId: Number(data.id),
    eventType: "opt_out",
    channel: "email",
    evidence
  });
}

export async function updateOutboundMessageStatus(input: {
  provider: string;
  providerMessageId: string;
  status: string;
  metadata?: JsonRecord;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("outbound_messages")
    .update({
      provider_status: input.status,
      metadata: input.metadata ?? undefined
    })
    .eq("provider", input.provider)
    .eq("provider_message_id", input.providerMessageId);

  throwIfError(error, "updateOutboundMessageStatus");
}
