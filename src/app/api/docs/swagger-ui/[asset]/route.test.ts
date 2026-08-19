import { createRequire } from "node:module";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: readFileMock,
  };
});

import { GET } from "@/app/api/docs/swagger-ui/[asset]/route";

const moduleRequire = createRequire(import.meta.url);
const ALLOWLISTED_CSS = moduleRequire.resolve("swagger-ui-dist/swagger-ui.css");
const ALLOWLISTED_BUNDLE = moduleRequire.resolve(
  "swagger-ui-dist/swagger-ui-bundle.js"
);
const ALLOWLISTED_PATHS = new Set([ALLOWLISTED_CSS, ALLOWLISTED_BUNDLE]);

function buildGetRequest(asset: string) {
  return [
    new Request(`http://localhost/api/docs/swagger-ui/${asset}`, {
      method: "GET",
    }),
    {
      params: Promise.resolve({ asset }),
    },
  ] as const;
}

async function parseJson(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    error?: { code?: string };
  };
}

describe("GET /api/docs/swagger-ui/[asset]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockImplementation(async (filePath: string) => {
      if (!ALLOWLISTED_PATHS.has(filePath)) {
        throw new Error(`Unexpected readFile path: ${filePath}`);
      }
      return Buffer.from(`fixture:${filePath}`);
    });
  });

  it("serves swagger-ui.css after allowlist resolution", async () => {
    const [request, context] = buildGetRequest("swagger-ui.css");

    const response = await GET(request, context);
    const payload = Buffer.from(await response.arrayBuffer()).toString("utf8");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(payload).toContain("fixture:");
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledWith(ALLOWLISTED_CSS);
  });

  it("serves swagger-ui-bundle.js after allowlist resolution", async () => {
    const [request, context] = buildGetRequest("swagger-ui-bundle.js");

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/javascript"
    );
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledWith(ALLOWLISTED_BUNDLE);
  });

  it.each([
    "../package.json",
    "swagger-ui.css/../../etc/passwd",
    encodeURIComponent("../package.json"),
    "%2e%2e%2fpackage.json",
  ])("rejects path traversal asset %s without reading a file", async (asset) => {
    const [request, context] = buildGetRequest(asset);

    const response = await GET(request, context);
    const body = await parseJson(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "NOT_FOUND",
      }),
    });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown asset", async () => {
    const [request, context] = buildGetRequest("swagger-ui-standalone-preset.js");

    const response = await GET(request, context);
    const body = await parseJson(response);

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
