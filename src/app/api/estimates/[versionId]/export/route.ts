import { z } from "zod";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  badRequest,
  forbidden,
  toErrorResponse,
} from "@/lib/estimates/errors";
import { streamEstimateVersionBdcV11Xlsx } from "@/lib/estimates/bdc-export";
import { streamEstimateVersionDpgfXlsx } from "@/lib/estimates/dpgf-export";
import { streamEstimateVersionXlsx } from "@/lib/estimates/export-stream";
import { exportEstimateVersionV3Csv } from "@/lib/estimates/v3-csv-export";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

type TenantRole = Database["public"]["Enums"]["tenant_role"];

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

function isExportAllowedRole(role: TenantRole) {
  return role === "admin" || role === "engineer";
}

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).versionId;
}

type ExportMode = "standard" | "dpgf" | "bdc";
type ExportFormat = "xlsx" | "csv";

function parseFormat(request: Request): ExportFormat {
  const rawFormat = new URL(request.url).searchParams.get("format");
  if (!rawFormat) return "xlsx";

  const normalized = rawFormat.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "xlsx") return "xlsx";
  // Lot 2, sous-lot 2.7b : CSV de l'éditeur d'une v3, écrit par le serveur depuis le document v3.
  if (normalized === "csv") return "csv";

  throw badRequest("Format d'export invalide. Valeurs supportees: xlsx, csv.");
}

function parseMode(request: Request): ExportMode {
  const rawMode = new URL(request.url).searchParams.get("mode");
  if (!rawMode) return "standard";

  const normalized = rawMode.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "standard") return "standard";
  if (normalized === "dpgf") return "dpgf";
  if (normalized === "bdc") return "bdc";

  throw badRequest("Mode d'export invalide. Valeurs supportees: standard, dpgf, bdc.");
}

async function assertExportAccess() {
  const { supabase, tenantId, tenantRole } =
    await getAuthenticatedTenantContext();

  if (!isExportAllowedRole(tenantRole)) {
    throw forbidden("Export reserve aux rôles admin et engineer.");
  }

  return {
    supabase,
    tenantId,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const format = parseFormat(request);
    const mode = parseMode(request);
    if (format === "csv" && mode !== "standard") {
      throw badRequest("Le format csv n'existe que pour l'export standard.");
    }
    await assertExportAccess();
    const exportOptions = {};

    if (format === "csv") {
      const csv = await exportEstimateVersionV3Csv(versionId);
      return new Response(csv.body, {
        status: 200,
        headers: {
          "Content-Type": csv.contentType,
          "Content-Disposition": `attachment; filename="${csv.filename}"`,
          "X-Export-Progress": csv.progress,
          "Cache-Control": "no-store",
        },
      });
    }

    const exported =
      mode === "dpgf"
        ? await streamEstimateVersionDpgfXlsx(versionId, exportOptions)
        : mode === "bdc"
          ? await streamEstimateVersionBdcV11Xlsx(versionId, exportOptions)
          : await streamEstimateVersionXlsx(versionId, exportOptions);

    return new Response(exported.stream, {
      status: 200,
      headers: {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "X-Export-Progress": exported.progress,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
