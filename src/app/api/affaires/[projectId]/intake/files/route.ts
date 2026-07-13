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
const AFFAIRE_INTAKE_MAX_MULTIPART_BODY_BYTES = 105 * 1024 * 1024;

async function getProjectId(paramsPromise: Promise<{ projectId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).projectId;
}

async function readBoundedMultipartFormData(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > AFFAIRE_INTAKE_MAX_MULTIPART_BODY_BYTES
  ) {
    throw badRequest("Le payload multipart depasse la taille maximale autorisee.");
  }

  if (!request.body) {
    return request.formData();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > AFFAIRE_INTAKE_MAX_MULTIPART_BODY_BYTES) {
      await reader.cancel();
      throw badRequest("Le payload multipart depasse la taille maximale autorisee.");
    }
    chunks.push(value);
  }

  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  });

  return boundedRequest.formData();
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
      formData = await readBoundedMultipartFormData(request);
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        throw error;
      }
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
