import { badRequest, ok, reviewTabularPdfImportFile, toErrorResponse } from "@/lib/imports/server";

async function parseMultipartFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw badRequest("Payload multipart invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const formData = await parseMultipartFormData(request);
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw badRequest("Aucun fichier PDF fourni.");
    }

    const sourceDocumentId =
      typeof formData.get("sourceDocumentId") === "string"
        ? String(formData.get("sourceDocumentId"))
        : typeof formData.get("source_document_id") === "string"
          ? String(formData.get("source_document_id"))
          : null;

    const data = await reviewTabularPdfImportFile({
      file,
      sourceDocumentId,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
