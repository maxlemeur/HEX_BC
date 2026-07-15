import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moduleRequire = createRequire(import.meta.url);

type SwaggerUiAsset = {
  contentType: string;
  filePath: string;
};

const SWAGGER_UI_ASSETS = new Map<string, SwaggerUiAsset>([
  [
    "swagger-ui.css",
    {
      contentType: "text/css; charset=utf-8",
      filePath: moduleRequire.resolve("swagger-ui-dist/swagger-ui.css"),
    },
  ],
  [
    "swagger-ui-bundle.js",
    {
      contentType: "application/javascript; charset=utf-8",
      filePath: moduleRequire.resolve("swagger-ui-dist/swagger-ui-bundle.js"),
    },
  ],
]);

function buildNotFoundResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Asset Swagger UI introuvable.",
      },
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> }
) {
  const { asset } = await params;

  const swaggerUiAsset = SWAGGER_UI_ASSETS.get(asset);
  if (!swaggerUiAsset) {
    return buildNotFoundResponse();
  }

  try {
    const payload = await readFile(swaggerUiAsset.filePath);
    return new NextResponse(payload, {
      status: 200,
      headers: {
        "Content-Type": swaggerUiAsset.contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return buildNotFoundResponse();
  }
}
