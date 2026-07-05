import { hashApprovalNonce, randomNumericNonce } from "@/src/lib/crypto";
import { assertDailyLimit, getConfig, logExecution, updateTask } from "@/src/lib/db";
import { getEnv } from "@/src/lib/env";
import { sendSms } from "@/src/lib/integrations/twilio";
import { supabaseAdmin } from "@/src/lib/supabase";
import { Task } from "@/src/lib/types";

export interface ApprovalCommand {
  action: "approve" | "reject";
  taskId: number;
  nonce: string;
}

export function parseApprovalCommand(message: string): ApprovalCommand | null {
  const match = /^(APPROVE|REJECT)\s+#?(\d+)\s+(\d{6})$/i.exec(message.trim());

  if (!match) {
    return null;
  }

  return {
    action: match[1].toLowerCase() === "approve" ? "approve" : "reject",
    taskId: Number(match[2]),
    nonce: match[3]
  };
}

export async function taskRequiresApproval(task: Task): Promise<boolean> {
  if (task.approval_used_at) {
    return false;
  }

  if (task.external_contact && task.action_type !== "briefing") {
    return true;
  }

  const approvalThresholdCents = await getConfig<number>("approval_threshold_cents", 50000);
  const estimatedValueCents = Math.round(Number(task.estimated_value ?? 0) * 100);

  return estimatedValueCents >= approvalThresholdCents;
}

export async function requestTaskApproval(task: Task, reason: string): Promise<void> {
  const env = getEnv();
  const ttlMinutes = await getConfig<number>("approval_ttl_minutes", 60);
  const nonce = randomNumericNonce(6);
  const nonceHash = hashApprovalNonce(task.id, nonce, env.APPROVAL_SECRET);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  await updateTask(task.id, {
    status: "awaiting_approval",
    approval_required: true,
    approval_nonce_hash: nonceHash,
    approval_expires_at: expiresAt,
    approval_requested_at: new Date().toISOString(),
    lease_expires_at: null,
    result_summary: `Awaiting approval: ${reason}`,
    metadata: {
      ...task.metadata,
      approval_reason: reason
    }
  });

  await assertDailyLimit("sms_sent", "max_sms_per_day");
  await sendSms(
    env.OWNER_PHONE,
    `[Robur AI] Approval required for task #${task.id}: ${task.description.slice(0, 220)}. Reply APPROVE #${task.id} ${nonce} or REJECT #${task.id} ${nonce}. Expires in ${ttlMinutes} minutes.`,
    task.id
  );

  await logExecution({
    taskId: task.id,
    actionType: "approval_requested",
    details: { reason, expires_at: expiresAt },
    outcome: "pending"
  });
}

export async function resolveApprovalCommand(command: ApprovalCommand, actorPhone: string): Promise<string> {
  const env = getEnv();

  if (actorPhone !== env.OWNER_PHONE) {
    await logExecution({
      taskId: command.taskId,
      actionType: "approval_denied",
      details: { actor_phone: actorPhone, reason: "owner_phone_mismatch" },
      outcome: "failure"
    });
    throw new Error("Only the owner phone can approve/reject tasks");
  }

  const { data, error } = await supabaseAdmin()
    .from("task_queue")
    .select("*")
    .eq("id", command.taskId)
    .eq("status", "awaiting_approval")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load approval task: ${error.message}`);
  }

  const task = data as Task | null;
  if (!task) {
    throw new Error(`Task #${command.taskId} is not awaiting approval`);
  }

  if (task.approval_used_at) {
    throw new Error(`Task #${command.taskId} approval was already used`);
  }

  if (!task.approval_nonce_hash) {
    throw new Error(`Task #${command.taskId} has no approval nonce`);
  }

  if (task.approval_expires_at && new Date(task.approval_expires_at).getTime() < Date.now()) {
    await updateTask(task.id, {
      status: "cancelled",
      result_summary: "Approval expired",
      approval_used_at: new Date().toISOString()
    });
    throw new Error(`Task #${command.taskId} approval expired`);
  }

  const expectedHash = hashApprovalNonce(task.id, command.nonce, env.APPROVAL_SECRET);
  if (expectedHash !== task.approval_nonce_hash) {
    await logExecution({
      taskId: task.id,
      actionType: "approval_nonce_invalid",
      details: { actor_phone: actorPhone },
      outcome: "failure"
    });
    throw new Error("Invalid approval nonce");
  }

  const now = new Date().toISOString();

  if (command.action === "reject") {
    await updateTask(task.id, {
      status: "cancelled",
      approval_used_at: now,
      approval_nonce_hash: null,
      result_summary: `Rejected by owner via SMS at ${now}`,
      lease_expires_at: null
    });

    await logExecution({
      taskId: task.id,
      actionType: "approval_rejected",
      details: { actor_phone: actorPhone },
      outcome: "success"
    });

    return `Task #${task.id} rejected and cancelled.`;
  }

  await updateTask(task.id, {
    status: "pending",
    approval_used_at: now,
    approval_nonce_hash: null,
    approval_expires_at: null,
    result_summary: null,
    lease_expires_at: null,
    metadata: {
      ...task.metadata,
      approved_by: actorPhone,
      approved_at: now
    }
  });

  await logExecution({
    taskId: task.id,
    actionType: "approval_granted",
    details: { actor_phone: actorPhone },
    outcome: "success"
  });

  return `Task #${task.id} approved and returned to the execution queue.`;
}
