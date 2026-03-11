import { badRequest, ok, reviewTabularPdfImport, toErrorResponse } from "@/lib/imports/server";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    const data = reviewTabularPdfImport(body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
