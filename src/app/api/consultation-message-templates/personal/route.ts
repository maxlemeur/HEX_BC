import { ok, toErrorResponse } from "@/lib/http/api-response";
import { readJsonBody } from "@/lib/http/json-body";
import {
  parseConsultationTemplateInput,
  resetPersonalConsultationTemplate,
  savePersonalConsultationTemplate,
} from "@/lib/material-requests/consultation-templates-server";

// TI-691: the member's own consultation message template, in their active tenant. Nobody else reads or writes it.

export async function PUT(request: Request) {
  try {
    return ok(await savePersonalConsultationTemplate(parseConsultationTemplateInput(await readJsonBody(request))));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    return ok(await resetPersonalConsultationTemplate());
  } catch (error) {
    return toErrorResponse(error);
  }
}
