import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { updateMaterialRequestFileSchema } from "@/lib/material-requests/contracts";
import {
  deleteMaterialRequestFile,
  readMaterialRequestFile,
  updateMaterialRequestFile,
} from "@/lib/material-requests/files-server";
import { fileParamsSchema, readJsonBody } from "@/lib/material-requests/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; requestId: string; fileId: string }> };

/** The bytes of an original, served by the application to whoever may read the affaire: no signed URL. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId, fileId } = fileParamsSchema.parse(await params);
    const file = await readMaterialRequestFile(projectId, requestId, fileId);
    const filename = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "original";
    const encoded = encodeURIComponent(file.fileName).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(file.body.stream(), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.body.size),
        "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, fileId } = fileParamsSchema.parse(await params);
    const input = updateMaterialRequestFileSchema.parse(await readJsonBody(request));
    return ok(await updateMaterialRequestFile(projectId, requestId, fileId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId, fileId } = fileParamsSchema.parse(await params);
    return ok(await deleteMaterialRequestFile(projectId, requestId, fileId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
