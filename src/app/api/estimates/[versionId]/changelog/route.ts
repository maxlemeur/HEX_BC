import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrBuildEstimateChangelog } from "@/lib/estimates/changelog";
import { badRequest, notFound, ok, toErrorResponse } from "@/lib/estimates/errors";
import { renderEstimateChangelogPdfBuffer } from "@/lib/estimates/pdf-generator";
import { getEstimateVersionDetails } from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

const querySchema = z.object({
  compare: z.string().uuid("compare invalide."),
  format: z.enum(["json", "pdf"]).optional(),
});

function formatVersionLabel(input: {
  versionNumber: number;
  title: string | null;
}) {
  const baseLabel = `V${input.versionNumber}`;
  if (!input.title || input.title.trim().length === 0) return baseLabel;
  return `${baseLabel} - ${input.title.trim()}`;
}

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  return querySchema.parse({
    compare: searchParams.get("compare"),
    format: searchParams.get("format") ?? undefined,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const parsedParams = paramsSchema.parse(await params);
    const query = parseQuery(request);

    if (query.compare === parsedParams.versionId) {
      throw badRequest("La comparaison doit cibler une autre version.");
    }

    const [currentDetails, previousDetails] = await Promise.all([
      getEstimateVersionDetails(parsedParams.versionId),
      getEstimateVersionDetails(query.compare),
    ]);

    if (
      currentDetails.version.tenant_id !== previousDetails.version.tenant_id ||
      currentDetails.version.project_id !== previousDetails.version.project_id
    ) {
      throw notFound("Version de comparaison introuvable.");
    }

    const supabase = await createSupabaseServerClient();
    const changelogResult = await getOrBuildEstimateChangelog({
      supabase,
      previous: previousDetails,
      current: currentDetails,
    });

    const previousVersionLabel = formatVersionLabel({
      versionNumber: previousDetails.version.version_number,
      title: previousDetails.version.title,
    });
    const currentVersionLabel = formatVersionLabel({
      versionNumber: currentDetails.version.version_number,
      title: currentDetails.version.title,
    });

    if (query.format === "pdf") {
      const pdfBuffer = await renderEstimateChangelogPdfBuffer({
        changelog: changelogResult.changelog,
        previousVersionLabel,
        currentVersionLabel,
      });
      const pdfBytes = new Uint8Array(pdfBuffer);

      const filename = `changelog-v${previousDetails.version.version_number}-v${currentDetails.version.version_number}.pdf`;

      return new NextResponse(pdfBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return ok({
      previousVersionId: previousDetails.version.id,
      currentVersionId: currentDetails.version.id,
      previousVersionLabel,
      currentVersionLabel,
      cacheStatus: changelogResult.cacheStatus,
      computedAt: changelogResult.computedAt,
      changelog: changelogResult.changelog,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
