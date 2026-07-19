import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  badRequest,
  conflict,
  internalError,
  notFound,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";
import {
  generateEstimatePdfNow,
  getEstimatePdfStatus,
  markEstimatePdfFailed,
  markEstimatePdfProcessing,
} from "@/lib/estimates/pdf-generator";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

export const runtime = "nodejs";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

const estimatePdfLayoutSchema = z.object({
  preset: z.enum(["client_detailed", "decision_summary", "fo_mo"]),
  detailLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal("lines")]),
  priceMode: z.enum(["total_only", "unit_and_total", "fo_mo_and_total"]),
  density: z.enum(["compact", "standard", "comfortable"]),
  showNumbering: z.boolean(),
  showSectionSubtotals: z.boolean(),
  conditionsPlacement: z.enum(["auto", "new_page"]),
  includeTerms: z.boolean(),
});

const requestBodySchema = z.object({
  layout: estimatePdfLayoutSchema.optional(),
});

type JsonErrorPayload = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseRequestBody(request: Request) {
  const rawBody = await request.text();
  if (!rawBody.trim()) return {};
  try {
    return requestBodySchema.parse(JSON.parse(rawBody)) as {
      layout?: EstimatePdfLayoutOptions;
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw badRequest("Le corps JSON est invalide.");
    }
    throw error;
  }
}

function parseForceQuery(request: Request) {
  const rawValue = new URL(request.url).searchParams.get("force");
  if (!rawValue) return false;

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }

  return false;
}

function parseFormatQuery(request: Request) {
  const rawValue = new URL(request.url).searchParams.get("format");
  if (!rawValue) return null;

  const normalized = rawValue.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) return message;
  }

  return "Une erreur est survenue pendant la generation du PDF.";
}

function jsonError(input: {
  status: 404 | 500;
  code: "PDF_NOT_READY" | "PDF_GENERATION_FAILED";
  message: string;
  details?: unknown;
}) {
  const payload: JsonErrorPayload = {
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      details: input.details,
    },
  };

  return NextResponse.json(payload, {
    status: input.status,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const force = parseForceQuery(request);
    const body = await parseRequestBody(request);

    const currentStatus = await getEstimatePdfStatus(versionId);

    if (!force) {
      if (currentStatus.status === "ready") {
        return ok(currentStatus);
      }

      if (currentStatus.status === "processing") {
        return NextResponse.json(
          {
            ok: true,
            data: currentStatus,
          },
          { status: 202 }
        );
      }
    }

    await markEstimatePdfProcessing(versionId);

    after(async () => {
      try {
        await generateEstimatePdfNow(versionId, {
          force,
          triggeredBy: "manual",
          layout: body.layout,
        });
      } catch (error) {
        try {
          await markEstimatePdfFailed(versionId, toSafeErrorMessage(error));
        } catch {
          // Best effort update: avoid failing the response lifecycle.
        }
      }
    });

    return NextResponse.json(
      {
        ok: true,
        data: {
          status: "processing",
        },
      },
      { status: 202 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const format = parseFormatQuery(request);
    const status = await getEstimatePdfStatus(versionId);

    if (format === "json") {
      if (status.status === "ready") {
        return ok(status);
      }

      if (status.status === "processing") {
        return NextResponse.json(
          {
            ok: true,
            data: status,
          },
          { status: 202 }
        );
      }

      if (status.status === "failed") {
        return jsonError({
          status: 500,
          code: "PDF_GENERATION_FAILED",
          message:
            status.last_error ?? "La generation du PDF a echoue pour cette version.",
          details: status,
        });
      }

      return jsonError({
        status: 404,
        code: "PDF_NOT_READY",
        message: "Aucun PDF genere pour cette version.",
        details: status,
      });
    }

    if (status.status === "ready") {
      return NextResponse.redirect(status.download_url, { status: 307 });
    }

    if (status.status === "failed") {
      throw internalError(
        status.last_error ?? "La generation du PDF a echoue pour cette version.",
        status,
        "PDF_GENERATION_FAILED"
      );
    }

    if (status.status === "processing") {
      throw conflict("Generation PDF en cours.", status, "PDF_NOT_READY");
    }

    throw notFound("Aucun PDF genere pour cette version.", status, "PDF_NOT_READY");
  } catch (error) {
    return toErrorResponse(error);
  }
}
