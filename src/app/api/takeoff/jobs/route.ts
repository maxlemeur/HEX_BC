import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { createTakeoffJobFromFormData } from "@/lib/takeoff/server";

async function parseMultipartFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    throw badRequest("Payload multipart invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const formData = await parseMultipartFormData(request);
    const data = await createTakeoffJobFromFormData(formData, {
      idempotencyKey: request.headers.get("idempotency-key"),
    });

    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
