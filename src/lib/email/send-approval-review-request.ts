import { Resend } from "resend";

import { COMPANY_INFO } from "@/lib/company-info";
import { ApprovalReviewRequestEmailTemplate } from "@/lib/email/templates/approval-review-request";
import { internalError } from "@/lib/estimates/errors";

type SendApprovalReviewRequestNotificationInput = {
  recipientEmail: string;
  reviewerName: string;
  requesterName: string;
  projectName: string;
  versionNumber: number;
  submissionMessage?: string | null;
  ruleLabels: string[];
};

function getRequiredEnvVar(name: "RESEND_API_KEY" | "EMAIL_FROM") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw internalError(`Configuration email manquante: ${name}.`);
  }
  return value;
}

export async function sendApprovalReviewRequestNotification(
  input: SendApprovalReviewRequestNotificationInput
) {
  const resend = new Resend(getRequiredEnvVar("RESEND_API_KEY"));
  const subject = `Validation requise - ${input.projectName} V${input.versionNumber}`;
  const { data, error } = await resend.emails.send({
    from: getRequiredEnvVar("EMAIL_FROM"),
    to: input.recipientEmail,
    subject,
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
