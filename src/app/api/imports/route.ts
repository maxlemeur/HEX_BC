import {
  requireImportWriteAccess,
  createImportFromJsonBody,
  createImportFromMultipartFormData,
  listUserImports,
  ok,
  toErrorResponse,
  unsupportedMediaType,
} from "@/lib/imports/server";

import { readImportFormData, readImportJson } from "@/lib/imports/request-body";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id") ?? searchParams.get("projectId");

    const data = await listUserImports({
      projectId,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

    if (contentType.includes("application/json")) {
      const context = await requireImportWriteAccess("route");
      const body = await readImportJson(request);
      const data = await createImportFromJsonBody(body, context);
      return ok(data, 201);
    }

    if (contentType.includes("multipart/form-data")) {
      const context = await requireImportWriteAccess("route");
      const formData = await readImportFormData(request);
      const data = await createImportFromMultipartFormData(formData, { context });
      return ok(data, 201);
    }

    throw unsupportedMediaType(
      "Content-Type non supporte. Utiliser application/json ou multipart/form-data."
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
