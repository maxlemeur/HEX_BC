import { z } from "zod";

import {
  buildEstimateApprovalDecisionJournalCsv,
  listEstimateApprovalDecisionJournal,
} from "@/lib/estimates/rules-engine";
import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParam } from "@/lib/http/request";

const querySchema = z.object({
  author: z.string().uuid("author invalide.").optional(),
  status: z
    .enum(["approved", "approved_with_reservations", "changes_requested"])
    .optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

function getQuery(request: Request) {
  const url = new URL(request.url);
  return querySchema.parse({
    author: url.searchParams.get("author") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    format: url.searchParams.get("format") ?? "json",
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const query = getQuery(request);
    const journal = await listEstimateApprovalDecisionJournal({
      versionId,
      actorUserId: query.author ?? null,
      decision: query.status ?? null,
    });

    if (query.format === "csv") {
      const csv = buildEstimateApprovalDecisionJournalCsv(journal);
      return new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="approval-journal-${versionId}.csv"`,
        },
      });
    }

    return ok(journal);
  } catch (error) {
    return toErrorResponse(error);
  }
}
