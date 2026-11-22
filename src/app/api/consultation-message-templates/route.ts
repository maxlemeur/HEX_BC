import { ok, toErrorResponse } from "@/lib/http/api-response";
import { readConsultationTemplates } from "@/lib/material-requests/consultation-templates-server";

// TI-691: the caller's own consultation message template and their company's. Rights in the domain module and RLS.

export async function GET() {
  try {
    return ok(await readConsultationTemplates());
  } catch (error) {
    return toErrorResponse(error);
  }
}
