import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/docs/route";
import { GET as GET_SWAGGER_UI_ASSET } from "@/app/api/docs/swagger-ui/[asset]/route";
import { generateOpenApiDocument } from "@/lib/openapi/generate";

type MutableEnv = Record<string, string | undefined>;
const mutableEnv = process.env as MutableEnv;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
const ORIGINAL_ENABLE_OPENAPI_DOCS = process.env.ENABLE_OPENAPI_DOCS;

function setEnvVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete mutableEnv[name];
    return;
  }

  mutableEnv[name] = value;
}

function restoreOpenApiEnv() {
  setEnvVariable("NODE_ENV", ORIGINAL_NODE_ENV);
  setEnvVariable("VERCEL_ENV", ORIGINAL_VERCEL_ENV);
  setEnvVariable("ENABLE_OPENAPI_DOCS", ORIGINAL_ENABLE_OPENAPI_DOCS);
}

afterEach(() => {
  restoreOpenApiEnv();
});

describe("generateOpenApiDocument", () => {
  it("builds an OpenAPI 3.1 document from registry + Zod schemas", () => {
    const document = generateOpenApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/api/estimates");
    expect(document.paths).toHaveProperty("/api/estimates/{versionId}/items");
    expect(document.paths).toHaveProperty("/api/estimates/{versionId}/items/move");
    expect(document.paths).toHaveProperty("/api/estimates/{versionId}/batch");
    expect(document.paths).toHaveProperty("/api/estimates/{versionId}/export");
    expect(document.components.schemas).toHaveProperty("CreateEstimateRequest");
    expect(document.components.schemas).toHaveProperty("MoveEstimateItemRequest");
    expect(document.components.schemas).toHaveProperty("ApiFailureResponse");

    const patchOperation = document.paths["/api/estimates/{versionId}"]?.patch as
      | Record<string, unknown>
      | undefined;
    expect(patchOperation).toBeDefined();
    expect(patchOperation?.responses).toHaveProperty("400");
  });
});

describe("GET /api/docs", () => {
  it("returns 404 in production when docs are disabled", async () => {
    setEnvVariable("NODE_ENV", "production");
    setEnvVariable("VERCEL_ENV", "production");
    setEnvVariable("ENABLE_OPENAPI_DOCS", undefined);

    const request = new Request("http://localhost/api/docs?format=json", {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "NOT_FOUND",
        }),
      })
    );
  });

  it("returns JSON OpenAPI when the feature flag is enabled", async () => {
    setEnvVariable("NODE_ENV", "production");
    setEnvVariable("VERCEL_ENV", "production");
    setEnvVariable("ENABLE_OPENAPI_DOCS", "true");

    const request = new Request("http://localhost/api/docs?format=json", {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(payload).toEqual(
      expect.objectContaining({
        openapi: "3.1.0",
        paths: expect.any(Object),
      })
    );
  });

  it("returns Swagger HTML in development mode", async () => {
    setEnvVariable("NODE_ENV", "development");
    setEnvVariable("ENABLE_OPENAPI_DOCS", undefined);

    const request = new Request("http://localhost/api/docs", {
      method: "GET",
      headers: {
        accept: "text/html",
      },
    });

    const response = await GET(request);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("SwaggerUIBundle");
    expect(html).toContain("/api/docs/swagger-ui/swagger-ui.css");
    expect(html).toContain("/api/docs/swagger-ui/swagger-ui-bundle.js");
    expect(html).toContain("/api/docs?format=json");
  });

  it("returns Swagger HTML in staging preview mode", async () => {
    setEnvVariable("NODE_ENV", "production");
    setEnvVariable("VERCEL_ENV", "preview");
    setEnvVariable("ENABLE_OPENAPI_DOCS", undefined);

    const request = new Request("http://localhost/api/docs", {
      method: "GET",
      headers: {
        accept: "text/html",
      },
    });

    const response = await GET(request);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("/api/docs/swagger-ui/swagger-ui.css");
    expect(html).toContain("/api/docs/swagger-ui/swagger-ui-bundle.js");
  });
});

describe("GET /api/docs/swagger-ui/[asset]", () => {
  it("serves whitelisted Swagger UI assets", async () => {
    const request = new Request(
      "http://localhost/api/docs/swagger-ui/swagger-ui.css",
      {
        method: "GET",
      }
    );

    const response = await GET_SWAGGER_UI_ASSET(request, {
      params: Promise.resolve({ asset: "swagger-ui.css" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  it("blocks path traversal attempts", async () => {
    const request = new Request(
      "http://localhost/api/docs/swagger-ui/../../package.json",
      {
        method: "GET",
      }
    );

    const response = await GET_SWAGGER_UI_ASSET(request, {
      params: Promise.resolve({ asset: "../package.json" }),
    });

    expect(response.status).toBe(404);
  });
});
