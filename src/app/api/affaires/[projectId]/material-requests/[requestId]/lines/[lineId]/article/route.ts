import { ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createMaterialRequestLineArticle,
  linkMaterialRequestLineArticle,
  unlinkMaterialRequestLineArticle,
} from "@/lib/material-requests/articles-server";
import {
  createMaterialRequestLineArticleSchema,
  linkMaterialRequestLineArticleSchema,
} from "@/lib/material-requests/contracts";
import { lineParamsSchema, readJsonBody } from "@/lib/material-requests/http";

type Context = { params: Promise<{ projectId: string; requestId: string; lineId: string }> };

/** Links the line to an article of the catalogue. */
export async function PUT(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, lineId } = lineParamsSchema.parse(await params);
    const input = linkMaterialRequestLineArticleSchema.parse(await readJsonBody(request));
    return ok(await linkMaterialRequestLineArticle(projectId, requestId, lineId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Creates the article the line names, as a draft of the catalogue, and links it. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, lineId } = lineParamsSchema.parse(await params);
    const input = createMaterialRequestLineArticleSchema.parse(await readJsonBody(request));
    return ok(await createMaterialRequestLineArticle(projectId, requestId, lineId, input), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId, lineId } = lineParamsSchema.parse(await params);
    return ok(await unlinkMaterialRequestLineArticle(projectId, requestId, lineId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
