import { NextRequest } from "next/server";
import { createPolicyChangeRequest, createTasks, logExecution } from "@/src/lib/db";
import { requireDashboardAuth, withRouteErrors } from "@/src/lib/http";
import { classifyChangeRequest, redactSensitiveText, stablePolicyRequestHash } from "@/src/lib/policy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withRouteErrors(async () => {
    requireDashboardAuth(request);

    const body = (await request.json()) as {
      requestText?: unknown;
      requestedBy?: unknown;
    };
    const requestText = typeof body.requestText === "string" ? body.requestText.trim() : "";
    const requestedBy = typeof body.requestedBy === "string" && body.requestedBy.trim() ? body.requestedBy.trim() : "dashboard_admin";

    if (!requestText) {
      throw Object.assign(new Error("requestText is required"), { status: 400 });
    }

    const classification = classifyChangeRequest(requestText);

    if (classification.classification === "protected_policy") {
      const proposal = await createPolicyChangeRequest({
        requestedBy,
        requestSource: "admin_change_request",
        requestText,
        riskLevel: classification.riskLevel,
        protectedPolicyKeys: classification.protectedPolicyKeys,
        proposedChangeSummary: classification.summary,
        proposedDiffOrConfig: {
          request_hash: stablePolicyRequestHash(requestText),
          activation: "proposal_only"
        },
        auditMetadata: {
          route: "/api/admin/change-request",
          classification: classification.classification
        }
      });

      return {
        ok: true,
        classification: classification.classification,
        policy_change_request_id: proposal.id,
        message:
          "Protected policy changes cannot be applied by ordinary chat. Owner approval for external contact cannot be removed by ordinary chat; this request was saved as a policy-change proposal for human review."
      };
    }

    const created = await createTasks([
      {
        source: "admin_change_request",
        description:
          classification.classification === "external_contact"
            ? `Prepare a bounded, owner-approved external-contact plan: ${redactSensitiveText(requestText).slice(0, 500)}`
            : `Implement internal strategy change after validation: ${redactSensitiveText(requestText).slice(0, 500)}`,
        priority_score: classification.classification === "external_contact" ? 70 : 55,
        action_type: "data_entry",
        action_payload: {
          request_hash: stablePolicyRequestHash(requestText),
          classification: classification.classification
        },
        metadata: {
          requested_by: redactSensitiveText(requestedBy),
          change_request_summary: classification.summary,
          requires_owner_approval_before_external_contact: classification.classification === "external_contact"
        },
        external_contact: false
      }
    ]);

    await logExecution({
      actionType: "admin_change_request_received",
      details: {
        classification: classification.classification,
        tasks_created: created,
        request_hash: stablePolicyRequestHash(requestText)
      },
      outcome: "success"
    });

    return {
      ok: true,
      classification: classification.classification,
      tasks_created: created,
      message:
        classification.classification === "external_contact"
          ? "External-contact request captured as preparation work. Any actual non-owner call, SMS, or email still requires task-specific owner approval."
          : "Internal change request captured as a task for validation."
    };
  });
}
