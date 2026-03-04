import {
  badRequest,
  createImportFromJsonBody,
  createImportFromMultipartFormData,
  listUserImports,
  ok,
  toErrorResponse,
  unsupportedMediaType,
} from "@/lib/imports/server";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

async function parseMultipartFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw badRequest("Payload multipart invalide.");
  }
}

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
      const body = await parseJsonBody(request);
      const data = await createImportFromJsonBody(body);
      return ok(data, 201);
    }

    if (contentType.includes("multipart/form-data")) {
      const formData = await parseMultipartFormData(request);
      const data = await createImportFromMultipartFormData(formData);
      return ok(data, 201);
    }

    throw unsupportedMediaType(
      "Content-Type non supporte. Utiliser application/json ou multipart/form-data."
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
