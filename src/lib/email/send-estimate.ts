import { Resend } from "resend";

import { COMPANY_INFO } from "@/lib/company-info";
import { EstimateEmailTemplate } from "@/lib/email/templates/estimate";
import {
  internalError,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "@/lib/estimates/errors";
import type { SendEstimateInput } from "@/lib/estimates/schemas";
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { generateEstimatePdfNow } from "@/lib/estimates/pdf-generator";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateVersionForEmail = Pick<
  EstimateVersionRow,
  "id" | "version_number" | "total_ttc_cents" | "currency"
> & {
  estimate_projects:
    | Pick<EstimateProjectRow, "name">
    | Pick<EstimateProjectRow, "name">[]
    | null;
};

type SendEstimateEmailInput = {
  versionId: string;
  payload: SendEstimateInput;
  requestUrl: string;
};

const ESTIMATE_DOCUMENTS_BUCKET = "estimate-documents";
const DEFAULT_FALLBACK_PROJECT_NAME = "Votre projet";
const DEFAULT_FALLBACK_FILENAME = "devis";

function resolveProject(value: EstimateVersionForEmail["estimate_projects"]) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function sanitizeFilename(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function buildAttachmentFilename(projectName: string, versionNumber: number) {
  const baseName = sanitizeFilename(projectName) || DEFAULT_FALLBACK_FILENAME;
  return `${baseName}_V${versionNumber}.pdf`;
}

function resolvePortalUrl(versionId: string, requestUrl: string) {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL?.trim();
  if (configuredBaseUrl) {
    try {
      const normalizedBaseUrl = configuredBaseUrl.endsWith("/")
        ? configuredBaseUrl
        : `${configuredBaseUrl}/`;
      return new URL(`estimates/${versionId}`, normalizedBaseUrl).toString();
    } catch {
      // Fallback handled below.
    }
  }

  return new URL(`/dashboard/estimates/${versionId}/print`, requestUrl).toString();
}

function getRequiredEnvVar(name: "RESEND_API_KEY" | "EMAIL_FROM") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw internalError(`Configuration email manquante: ${name}.`);
  }
  return value;
}

async function loadVersionForEmail(versionId: string): Promise<EstimateVersionForEmail> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data, error } = await supabase
    .from("estimate_versions")
    .select("id, version_number, total_ttc_cents, currency, estimate_projects(name)")
    .eq("id", versionId)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la version de devis.");
  }

  if (!data) {
    throw notFound("Version de devis introuvable.");
  }

  return data as EstimateVersionForEmail;
}

async function loadPdfBuffer(filePath: string): Promise<Buffer> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.storage
    .from(ESTIMATE_DOCUMENTS_BUCKET)
    .download(filePath);

  if (error || !data) {
    throw internalError(
      "Impossible de recuperer le PDF du devis pour l'email.",
      error
    );
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function sendEstimateEmail(input: SendEstimateEmailInput) {
  const version = await loadVersionForEmail(input.versionId);
  const generatedPdf = await generateEstimatePdfNow(input.versionId, {
    force: true,
    triggeredBy: "send",
  });
  const pdfBuffer = await loadPdfBuffer(generatedPdf.file_path);

  const projectName =
    resolveProject(version.estimate_projects)?.name?.trim() ||
    DEFAULT_FALLBACK_PROJECT_NAME;
  const currency = normalizeEstimateCurrency(version.currency) ?? "EUR";
  const totalTtcFormatted = formatCurrency(version.total_ttc_cents ?? 0, currency);
  const portalUrl = resolvePortalUrl(input.versionId, input.requestUrl);

  const resend = new Resend(getRequiredEnvVar("RESEND_API_KEY"));
  const { data, error } = await resend.emails.send({
    from: getRequiredEnvVar("EMAIL_FROM"),
    to: input.payload.to,
    cc: input.payload.cc,
    subject: input.payload.subject,
    react: EstimateEmailTemplate({
      projectName,
      versionNumber: version.version_number,
      totalTtcFormatted,
      portalUrl,
      message: input.payload.message,
      companyName: COMPANY_INFO.name,
    }),
    attachments: [
      {
        filename: buildAttachmentFilename(projectName, version.version_number),
        content: pdfBuffer,
      },
    ],
  });

  if (error) {
    throw internalError("Erreur lors de l'envoi de l'email.", error);
  }

  return {
    message_id: data?.id ?? null,
  };
}
