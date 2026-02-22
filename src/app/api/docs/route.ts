import { NextResponse } from "next/server";

import { generateOpenApiDocument } from "@/lib/openapi/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isOpenApiDocsEnabled(): boolean {
  if (isTruthyEnvValue(process.env.ENABLE_OPENAPI_DOCS)) {
    return true;
  }

  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim().toLowerCase();
  return vercelEnv === "preview";
}

function resolveResponseFormat(request: Request): "json" | "html" {
  const url = new URL(request.url);
  const explicitFormat = url.searchParams.get("format")?.trim().toLowerCase();

  if (explicitFormat === "json") {
    return "json";
  }

  if (explicitFormat === "html" || explicitFormat === "ui") {
    return "html";
  }

  const acceptHeader = request.headers.get("accept")?.toLowerCase() ?? "";
  if (
    acceptHeader.includes("application/json") &&
    !acceptHeader.includes("text/html")
  ) {
    return "json";
  }

  return "html";
}

function renderSwaggerHtml(specUrl: string): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HEX BC API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #f8fafc;
      }

      #swagger-ui {
        max-width: 1200px;
        margin: 0 auto;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true
      });
    </script>
  </body>
</html>`;
}

export async function GET(request: Request) {
  if (!isOpenApiDocsEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Documentation OpenAPI desactivee.",
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

  const format = resolveResponseFormat(request);
  const spec = generateOpenApiDocument();

  if (format === "json") {
    return NextResponse.json(spec, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const docsUrl = new URL(request.url);
  docsUrl.search = "";
  const specUrl = `${docsUrl.pathname}?format=json`;
  const html = renderSwaggerHtml(specUrl);

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
