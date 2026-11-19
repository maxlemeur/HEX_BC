import { Resend } from "resend";

import { COMPANY_INFO } from "@/lib/company-info";
import { readOutgoingEmailRouting, routeOutgoingEmail } from "@/lib/email/outgoing-routing";
import { ApprovalReviewRequestEmailTemplate } from "@/lib/email/templates/approval-review-request";
import { internalError } from "@/lib/http/api-response";
import { getRequiredEnvVar } from "@/lib/email/send-estimate-context-server";

type SendApprovalReviewRequestNotificationInput = {
  recipientEmail: string;
  reviewerName: string;
  requesterName: string;
  projectName: string;
  versionNumber: number;
  submissionMessage?: string | null;
  ruleLabels: string[];
};

export async function sendApprovalReviewRequestNotification(
  input: SendApprovalReviewRequestNotificationInput
) {
  const resend = new Resend(getRequiredEnvVar("RESEND_API_KEY"));
  const from = getRequiredEnvVar("EMAIL_FROM");
  const subject = `Validation requise - ${input.projectName} V${input.versionNumber}`;
  const routed = routeOutgoingEmail(readOutgoingEmailRouting(), { to: input.recipientEmail, subject });
  const { data, error } = await resend.emails.send({
    from,
    to: routed.to,
    subject: routed.subject,
    react: ApprovalReviewRequestEmailTemplate({
      reviewerName: input.reviewerName,
      requesterName: input.requesterName,
      projectName: input.projectName,
      versionNumber: input.versionNumber,
      companyName: COMPANY_INFO.name,
      submissionMessage: input.submissionMessage ?? null,
      ruleLabels: input.ruleLabels,
    }),
  });

  if (error) {
    throw internalError("Erreur lors de l'envoi de l'email interne de validation.", error);
  }

  return {
    message_id: data?.id ?? null,
    subject,
  };
}
