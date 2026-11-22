import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { badRequest, forbidden } from "@/lib/http/api-error";
import { mapSupabaseError, type SupabaseErrorLike } from "@/lib/http/api-response";

import {
  consultationTemplateInputSchema,
  type ConsultationTemplateInput,
  type ConsultationTemplateRecord,
  type ConsultationTemplates,
} from "./consultation-template-contracts";

/**
 * The consultation message templates of the caller (TI-691). The member's own template is read and written with
 * their session, under RLS: the database sets its tenant (the active one) and its member, and nobody else reads it.
 * The company's is read by the members of the active tenant and written only through two database functions that
 * check, again, that the caller administers the active tenant. Its author is never read.
 */

const PERSONAL = "material_request_message_templates";
const COMPANY = "tenant_consultation_message_templates";
/** Explicit columns: members are granted these only on the company table, never its author. */
const COLUMNS = "message_template, line_template";
const ADMIN_ONLY = "Seuls les administrateurs de l’entreprise modifient son modèle de message.";

function mapTemplateError(error: SupabaseErrorLike, fallback: string) {
  if (error.message?.includes("TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY")) {
    return forbidden(ADMIN_ONLY, undefined, "TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY");
  }
  if (error.code === "23514") return badRequest("Le modèle est vide ou trop long.", undefined, "CONSULTATION_TEMPLATE_INVALID");
  return mapSupabaseError(error, fallback);
}

/** Validates both texts, line ends folded; a refusal says why in the editor's words. */
export function parseConsultationTemplateInput(body: unknown): ConsultationTemplateInput {
  const folded =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.fromEntries(
          Object.entries(body as Record<string, unknown>).map(([key, value]) => [
            key,
            typeof value === "string" ? value.replace(/\r\n?/g, "\n") : value,
          ]),
        )
      : body;
  const parsed = consultationTemplateInputSchema.safeParse(folded);
  if (parsed.success) return parsed.data;
  const messages = [...new Set(parsed.error.issues.map((issue) => issue.message))];
  throw badRequest(messages.join(" "), { issues: messages }, "CONSULTATION_TEMPLATE_INVALID");
}

function record(row: { message_template: string; line_template: string } | null): ConsultationTemplateRecord | null {
  return row ? { message_template: row.message_template, line_template: row.line_template } : null;
}

async function readPersonal(context: AuthenticatedTenantContext): Promise<ConsultationTemplateRecord | null> {
  const { data, error } = await context.supabase
    .from(PERSONAL)
    .select(COLUMNS)
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw mapTemplateError(error, "Impossible de lire votre modèle de message.");
  return record(data);
}

async function readCompany(context: AuthenticatedTenantContext): Promise<ConsultationTemplateRecord | null> {
  const { data, error } = await context.supabase
    .from(COMPANY)
    .select(COLUMNS)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapTemplateError(error, "Impossible de lire le modèle de message de l’entreprise.");
  return record(data);
}

export async function readConsultationTemplates(): Promise<ConsultationTemplates> {
  const context = await getAuthenticatedTenantContext();
  const [personal, company] = await Promise.all([readPersonal(context), readCompany(context)]);
  return { personal, company, can_edit_company: context.isTenantAdmin };
}

/** Saves the member's own template: one row per membership, replaced by each save. */
export async function savePersonalConsultationTemplate(
  input: ConsultationTemplateInput,
): Promise<{ personal: ConsultationTemplateRecord }> {
  const context = await getAuthenticatedTenantContext();
  const values = { message_template: input.message_template, line_template: input.line_template };
  const update = async () => {
    const { data, error } = await context.supabase
      .from(PERSONAL)
      .update(values)
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId)
      .select(COLUMNS);
    if (error) throw mapTemplateError(error, "Impossible d’enregistrer votre modèle de message.");
    return record(data?.[0] ?? null);
  };
  const updated = await update();
  if (updated) return { personal: updated };
  const inserted = await context.supabase.from(PERSONAL).insert(values).select(COLUMNS).single();
  if (!inserted.error) return { personal: record(inserted.data)! };
  // Saved meanwhile from another tab: this save replaces it.
  if (inserted.error.code === "23505") {
    const replaced = await update();
    if (replaced) return { personal: replaced };
  }
  throw mapTemplateError(inserted.error, "Impossible d’enregistrer votre modèle de message.");
}

/** « Rétablir le modèle par défaut »: the member follows the company's template again, else today's message. */
export async function resetPersonalConsultationTemplate(): Promise<{ personal: null }> {
  const context = await getAuthenticatedTenantContext();
  const { error } = await context.supabase
    .from(PERSONAL)
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.userId);
  if (error) throw mapTemplateError(error, "Impossible de rétablir le modèle par défaut.");
  return { personal: null };
}

function requireCompanyAdmin(context: AuthenticatedTenantContext) {
  // The membership's role in the active tenant; the database functions check it again.
  if (!context.isTenantAdmin) throw forbidden(ADMIN_ONLY, undefined, "TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY");
}

export async function saveCompanyConsultationTemplate(
  input: ConsultationTemplateInput,
): Promise<{ company: ConsultationTemplateRecord }> {
  const context = await getAuthenticatedTenantContext();
  requireCompanyAdmin(context);
  const { data, error } = await context.supabase.rpc("save_tenant_consultation_message_template", {
    p_message_template: input.message_template,
    p_line_template: input.line_template,
  });
  if (error) throw mapTemplateError(error, "Impossible d’enregistrer le modèle de l’entreprise.");
  const row = (Array.isArray(data) ? data[0] : data) as ConsultationTemplateRecord | null | undefined;
  if (!row) throw badRequest("Impossible d’enregistrer le modèle de l’entreprise.");
  return { company: record(row)! };
}

/** « Rétablir le message d’origine »: the company's members without their own template get today's message. */
export async function resetCompanyConsultationTemplate(): Promise<{ company: null }> {
  const context = await getAuthenticatedTenantContext();
  requireCompanyAdmin(context);
  const { error } = await context.supabase.rpc("reset_tenant_consultation_message_template");
  if (error) throw mapTemplateError(error, "Impossible de rétablir le message d’origine.");
  return { company: null };
}
