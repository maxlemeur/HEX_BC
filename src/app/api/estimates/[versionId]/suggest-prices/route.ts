import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { suggestEstimateCataloguePrices } from "@/lib/estimates/server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

const suggestPricesQuerySchema = z.object({
  q: z.string().trim().min(2, "Le parametre q doit contenir au moins 2 caracteres."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

function getQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = suggestPricesQuerySchema.safeParse({
    q: searchParams.get("q") ?? "",
  });

  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Parametre q invalide.");
  }

  return parsed.data.q;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const query = getQuery(request);
    const data = await suggestEstimateCataloguePrices(versionId, query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
