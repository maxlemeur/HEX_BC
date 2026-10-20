import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SwaggerUiAsset = {
  contentType: string;
  filePath: string;
};

const SWAGGER_UI_ASSETS = new Map<string, SwaggerUiAsset>([
  [
    "swagger-ui.css",
    {
      contentType: "text/css; charset=utf-8",
      filePath: path.join(process.cwd(), "node_modules/swagger-ui-dist/swagger-ui.css"),
    },
  ],
  [
    "swagger-ui-bundle.js",
    {
      contentType: "application/javascript; charset=utf-8",
      filePath: path.join(process.cwd(), "node_modules/swagger-ui-dist/swagger-ui-bundle.js"),
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
        // The session Proxy can renew cookies even for these assets. A route
        // response must not replace its private/no-store policy with public TTLs.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return buildNotFoundResponse();
  }
}
