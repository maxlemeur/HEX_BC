import { z } from "zod";

import {
  CONSULTATION_LINE_TEMPLATE_MAX,
  CONSULTATION_MESSAGE_TEMPLATE_MAX,
  consultationTemplateRefusals,
  type ConsultationTemplate,
} from "./consultation-template";

/**
 * The consultation message templates as the API carries them (TI-691): the member's own and the company's general
 * one, each a pair of texts. Neither names its tenant, its member or its author: the database sets them.
 */
export type ConsultationTemplateRecord = { message_template: string; line_template: string };

export type ConsultationTemplates = {
  personal: ConsultationTemplateRecord | null;
  company: ConsultationTemplateRecord | null;
  /** The caller administers their active tenant: the company template is theirs to change. */
  can_edit_company: boolean;
  /**
   * False where the templates are not installed yet (migration not applied): no template exists, the built-in
   * message applies, and the screens say the setting is not available yet.
   */
  available: boolean;
};

function templateText(max: number, label: string) {
  return z
    .string()
    .max(max, `${label} : ${max} caractères au plus.`)
    .refine((value) => /\S/.test(value), { message: `${label} ne peut pas être vide.` })
    .refine((value) => !value.includes("\u0000"), { message: `${label} contient un caractère invalide.` });
}

/** Both texts, saved together. Windows line ends are folded by the server before this check. */
export const consultationTemplateInputSchema = z
  .object({
    message_template: templateText(CONSULTATION_MESSAGE_TEMPLATE_MAX, "Le modèle du message"),
    line_template: templateText(CONSULTATION_LINE_TEMPLATE_MAX, "Le modèle de ligne"),
  })
  .strict()
  .superRefine((value, context) => {
    for (const message of consultationTemplateRefusals({ message: value.message_template, line: value.line_template })) {
      context.addIssue({ code: "custom", message });
    }
  });

export type ConsultationTemplateInput = z.infer<typeof consultationTemplateInputSchema>;

export function templateOfRecord(record: ConsultationTemplateRecord | null): ConsultationTemplate | null {
  return record ? { message: record.message_template, line: record.line_template } : null;
}

/** The template in force for a member: their own, else the company's, else null (today's built-in message). */
export function templateInForce(templates: Pick<ConsultationTemplates, "personal" | "company">): ConsultationTemplate | null {
  return templateOfRecord(templates.personal) ?? templateOfRecord(templates.company);
}
