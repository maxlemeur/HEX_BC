import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moduleRequire = createRequire(import.meta.url);

type SwaggerUiDistModule = {
  getAbsoluteFSPath?: () => string;
  absolutePath?: string | (() => string);
};

function resolveSwaggerUiDistRoot(): string {
  const swaggerUiDist = moduleRequire("swagger-ui-dist") as SwaggerUiDistModule;

  if (typeof swaggerUiDist.getAbsoluteFSPath === "function") {
    return swaggerUiDist.getAbsoluteFSPath();
  }

  if (typeof swaggerUiDist.absolutePath === "function") {
    return swaggerUiDist.absolutePath();
  }

  if (typeof swaggerUiDist.absolutePath === "string") {
    return swaggerUiDist.absolutePath;
  }

  throw new Error("Unable to resolve swagger-ui-dist absolute path.");
}

const swaggerUiDistRoot = resolveSwaggerUiDistRoot();

const SWAGGER_UI_ASSETS = new Map<string, string>([
  ["swagger-ui.css", "text/css; charset=utf-8"],
  ["swagger-ui-bundle.js", "application/javascript; charset=utf-8"],
]);

function isValidAssetName(asset: string): boolean {
  return (
    asset.length > 0 &&
    !asset.includes("/") &&
    !asset.includes("\\") &&
    !asset.includes("\0") &&
    asset === path.basename(asset)
  );
}

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

  if (!isValidAssetName(asset)) {
    return buildNotFoundResponse();
  }

  const contentType = SWAGGER_UI_ASSETS.get(asset);
  if (!contentType) {
    return buildNotFoundResponse();
  }

  const candidatePath = path.resolve(swaggerUiDistRoot, asset);
  const relativePath = path.relative(swaggerUiDistRoot, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return buildNotFoundResponse();
  }

  try {
    const payload = await readFile(candidatePath);
    return new NextResponse(payload, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return buildNotFoundResponse();
  }
}
