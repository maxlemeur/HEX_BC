import { ok, toErrorResponse } from "@/lib/http/api-response";
import { readJsonBody } from "@/lib/http/json-body";
import {
  parseConsultationTemplateInput,
  resetCompanyConsultationTemplate,
  saveCompanyConsultationTemplate,
} from "@/lib/material-requests/consultation-templates-server";

// TI-691: the company's general consultation message template, written by the admins of the active tenant only.

export async function PUT(request: Request) {
  try {
    return ok(await saveCompanyConsultationTemplate(parseConsultationTemplateInput(await readJsonBody(request))));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    return ok(await resetCompanyConsultationTemplate());
  } catch (error) {
    return toErrorResponse(error);
  }
}
