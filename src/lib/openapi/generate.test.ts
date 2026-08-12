import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/docs/route";
import { GET as GET_SWAGGER_UI_ASSET } from "@/app/api/docs/swagger-ui/[asset]/route";
import { generateOpenApiDocument } from "@/lib/openapi/generate";
import { baseAdditionalOpenApiOperationsRegistry } from "@/lib/openapi/route-contracts";
import { workflowAdditionalOpenApiOperationsRegistry } from "@/lib/openapi/route-contracts-workflows";
import { openApiRouteExclusions } from "@/lib/openapi/route-exclusions";

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
    expect(document.paths).toHaveProperty("/api/imports");
    expect(document.paths).toHaveProperty("/api/portal/{token}/accept");
    expect(document.paths).toHaveProperty("/api/purchase-orders/{id}");
    expect(document.paths).toHaveProperty("/api/takeoff/plan-sets/{setId}");
    expect(document.paths["/api/purchase-orders/{id}"]).toHaveProperty("put");
    expect(
      (
        document.paths["/api/imports"]?.post as {
          requestBody?: { content?: Record<string, unknown> };
        }
      ).requestBody?.content
    ).toEqual(
      expect.objectContaining({
        "application/json": expect.any(Object),
        "multipart/form-data": expect.any(Object),
      })
    );
    const portalAcceptOperation = document.paths[
      "/api/portal/{token}/accept"
    ]?.post as {
      responses?: Record<
        string,
        { content?: { "application/json"?: { schema?: { $ref?: string } } } }
      >;
    };
    expect(
      portalAcceptOperation.responses?.["400"]?.content?.["application/json"]
        ?.schema?.$ref
    ).toBe("#/components/schemas/ApiGenericErrorResponse");

    const createEstimateSchema = document.components.schemas[
      "CreateEstimateRequest"
    ] as {
      allOf?: Array<{ anyOf?: Array<{ required?: string[] }> }>;
    };
    const createEstimateSelectorSchema = createEstimateSchema.allOf?.find(
      (schemaPart) => Array.isArray(schemaPart.anyOf)
    );
    expect(createEstimateSelectorSchema?.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          required: expect.arrayContaining(["project_id"]),
        }),
        expect.objectContaining({
          required: expect.arrayContaining(["project"]),
        }),
      ])
    );

    const instantiateTemplateSchema = document.components.schemas[
      "InstantiateEstimateFromTemplateRequest"
    ] as {
      allOf?: Array<{ anyOf?: Array<{ required?: string[] }> }>;
    };
    const instantiateTemplateSelectorSchema = instantiateTemplateSchema.allOf?.find(
      (schemaPart) => Array.isArray(schemaPart.anyOf)
    );
    expect(instantiateTemplateSelectorSchema?.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          required: expect.arrayContaining(["project_id"]),
        }),
        expect.objectContaining({
          required: expect.arrayContaining(["project_name"]),
        }),
      ])
    );

    const patchOperation = document.paths["/api/estimates/{versionId}"]?.patch as
      | Record<string, unknown>
      | undefined;
    expect(patchOperation).toBeDefined();
    expect(patchOperation?.responses).toHaveProperty("400");

    const sendOperation = document.paths[
      "/api/estimates/{versionId}/send"
    ]?.post as
      | { parameters?: Array<Record<string, unknown>> }
      | undefined;
    expect(sendOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Idempotency-Key",
          in: "header",
          required: true,
        }),
      ])
    );
    expect(
      JSON.stringify(document.components.schemas.ApiEstimateVersionResponse)
    ).toContain('"sending"');
    const exportOperation = document.paths[
      "/api/estimates/{versionId}/export"
    ]?.get as { parameters?: Array<Record<string, unknown>> } | undefined;
    expect(exportOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "mode",
          in: "query",
          schema: {
            $ref: "#/components/schemas/ExportModeQueryParameter",
          },
        }),
      ])
    );
    expect(document.components.schemas.ExportModeQueryParameter).toEqual({
      type: "string",
      enum: ["standard", "dpgf", "bdc"],
    });
    const estimateVersionResponseSchema = document.components.schemas[
      "ApiEstimateVersionResponse"
    ] as {
      properties?: {
        data?: {
          properties?: {
            version?: {
              properties?: {
                calc_engine_version?: unknown;
              };
            };
          };
        };
      };
    };
    expect(
      estimateVersionResponseSchema.properties?.data?.properties?.version
        ?.properties?.calc_engine_version
    ).toEqual({
      anyOf: [{ type: "number", const: 1 }, { type: "number", const: 2 }],
    });

    type JsonSchema = {
      anyOf?: JsonSchema[];
      properties?: Record<string, JsonSchema>;
      required?: string[];
      items?: JsonSchema;
      const?: unknown;
    };
    const approvalRequestSchema = document.components.schemas[
      "PostEstimateApprovalRequest"
    ] as JsonSchema;
    const approvalActionSchemas = approvalRequestSchema.anyOf ?? [];

    for (const action of ["approve", "reject"] as const) {
      const actionSchema = approvalActionSchemas.find((schema) =>
        schema.anyOf?.some(
          (variant) => variant.properties?.action?.const === action
        )
      );
      expect(actionSchema?.anyOf).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            required: expect.arrayContaining(["action", "rule_id"]),
          }),
          expect.objectContaining({
            required: expect.arrayContaining(["action", "approval_id"]),
          }),
        ])
      );
    }

    const decideSchema = approvalActionSchemas.find(
      (schema) => schema.properties?.action?.const === "decide"
    );
    const commentSchemas = decideSchema?.properties?.comments?.items?.anyOf;
    const projectCommentSchema = commentSchemas?.find(
      (schema) => schema.properties?.scope_type?.const === "project"
    );
    const scopedCommentSchema = commentSchemas?.find(
      (schema) => schema.properties?.scope_type?.const === undefined
    );

    expect(projectCommentSchema?.required).toEqual([
      "scope_type",
      "comment",
    ]);
    expect(scopedCommentSchema?.required).toEqual([
      "scope_type",
      "scope_id",
      "comment",
    ]);
  });

  it("documents application routes and keeps only infrastructure exclusions", () => {
    expect([
      ...baseAdditionalOpenApiOperationsRegistry,
      ...workflowAdditionalOpenApiOperationsRegistry,
    ]).toHaveLength(73);
    expect(openApiRouteExclusions).toHaveLength(5);
    expect(openApiRouteExclusions.map((entry) => entry.path)).toEqual([
      "/api/docs",
      "/api/docs/swagger-ui/{asset}",
      "/api/internal/takeoff/process-job",
      "/api/internal/workflows/recover",
      "/api/takeoff/metrics/stats",
    ]);
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
