import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { suggestEstimateCataloguePrices } from "@/lib/estimates/server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

const suggestPricesQuerySchema = z.object({
  q: z.string().trim().min(2, "Le paramètre q doit contenir au moins 2 caractères."),
  // TI-690: only a deliberate search asks for drafts; the inline suggestions never do.
  include_drafts: z.enum(["1", "true", "0", "false"]).nullable().optional(),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

function getQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = suggestPricesQuerySchema.safeParse({
    q: searchParams.get("q") ?? "",
    include_drafts: searchParams.get("include_drafts"),
  });

  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Paramètre q invalide.");
  }

  return {
    q: parsed.data.q,
    includeDrafts: parsed.data.include_drafts === "1" || parsed.data.include_drafts === "true",
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const { q, includeDrafts } = getQuery(request);
    const data = await suggestEstimateCataloguePrices(versionId, q, { includeDrafts });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
