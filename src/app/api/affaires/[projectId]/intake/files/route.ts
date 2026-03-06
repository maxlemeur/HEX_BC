import { after } from "next/server";
import { z } from "zod";

import { ok, badRequest, toErrorResponse } from "@/lib/estimates/errors";
import {
  createAffaireIntakeUpload,
  processAffaireIntakeUpload,
} from "@/lib/affaires/intake-server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
});

async function getProjectId(paramsPromise: Promise<{ projectId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).projectId;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const projectId = await getProjectId(params);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

    if (!contentType.includes("multipart/form-data")) {
      throw badRequest(
        "Content-Type invalide. Utiliser multipart/form-data pour l'intake affaire."
      );
    }

    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      throw badRequest("Payload multipart invalide.");
    }

    const result = await createAffaireIntakeUpload(projectId, formData);

    if (result.shouldProcessAsync) {
      after(async () => {
        try {
          await processAffaireIntakeUpload(result.uploadId);
        } catch (error) {
          console.error("Affaire intake async processing failed", {
            projectId,
            uploadId: result.uploadId,
            error,
          });
        }
      });
    }

    return ok(
      {
        uploadId: result.uploadId,
        files: result.files,
      },
      201
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
