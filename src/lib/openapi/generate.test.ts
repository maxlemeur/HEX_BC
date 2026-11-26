import Ajv from "ajv";

import published from "../../../openapi.json";
import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/docs/route";
import { GET as GET_SWAGGER_UI_ASSET } from "@/app/api/docs/swagger-ui/[asset]/route";

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
});

describe("GET /api/docs/swagger-ui/[asset]", () => {
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


describe("published catalogue review contracts", () => {
  const id = "90000000-0000-4000-8000-000000000001";

  it("publishes mutually exclusive review and validation targets", () => {
    const ajv = new Ajv();
    const review = ajv.compile(published.components.schemas.ReviewSupplierReferencesRequest);
    const expected_selection = "a".repeat(64);
    expect(review({ action: "validate", filter: {}, expected_count: 2, expected_selection })).toBe(true);
    expect(review({ action: "validate", filter: {}, expected_count: 2 })).toBe(true); // Legacy shape receives a documented 409.
    expect(review({ action: "validate", filter: {}, expected_count: 2, expected_selection: "invalid" })).toBe(false);
    expect(review({ action: "validate", filter: {} })).toBe(false);
    expect(review({ action: "validate", filter: {}, expected_count: 2, expected_selection, ids: [id] })).toBe(false);
    expect(published.paths["/api/catalogue/supplier-references"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ApiPendingSupplierReferencePage");
    const products = ajv.compile(published.components.schemas.BulkUpdateProductsRequest);
    expect(products({ action: "validate", import_batch_id: id })).toBe(true);
    expect(products({ action: "validate", ids: [id] })).toBe(true);
    expect(products({ action: "validate", ids: [id], import_batch_id: id })).toBe(false);
    expect(products({ action: "validate" })).toBe(false);
  });

  it("publishes typed suggestion and availability envelopes", () => {
    const operations = published.paths["/api/catalogue/workbook-import/suggestions"];
    expect(operations.get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ApiCostingWorkbookSuggestionProviders");
    expect(operations.post.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ApiCostingWorkbookSuggestions");
  });
});
