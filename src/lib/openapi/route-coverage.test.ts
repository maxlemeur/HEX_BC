import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openApiOperationsRegistry } from "@/lib/openapi/registry";
import {
  assertOpenApiRouteCoverage,
  discoverApiRouteOperations,
  type OpenApiRouteExclusion,
} from "@/lib/openapi/route-coverage";
import { openApiRouteExclusions } from "@/lib/openapi/route-exclusions";
import { baseAdditionalOpenApiOperationsRegistry } from "@/lib/openapi/route-contracts";
import { workflowAdditionalOpenApiOperationsRegistry } from "@/lib/openapi/route-contracts-workflows";
import type { OpenApiOperationDefinition } from "@/lib/openapi/registry";

const temporaryRoots: string[] = [];

function createProject(routes: Record<string, string>): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "openapi-routes-"));
  temporaryRoots.push(projectRoot);

  Object.entries(routes).forEach(([routeDirectory, source]) => {
    const directory = path.join(
      projectRoot,
      "src",
      "app",
      "api",
      ...routeDirectory.split("/")
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "route.ts"), source, "utf8");
  });

  return projectRoot;
}

function operation(
  method: OpenApiOperationDefinition["method"],
  routePath: string
): OpenApiOperationDefinition {
  return {
    method,
    path: routePath,
    summary: "Fixture",
    description: "Operation de test.",
    tags: ["Test"],
    responses: {
      "200": { description: "OK" },
    },
  };
}

afterEach(() => {
  temporaryRoots.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("discoverApiRouteOperations", () => {
  it("reads the HTTP names actually exported by Next.js route files", () => {
    const projectRoot = createProject({
      "widgets/[widgetId]": `
        async function updateWidget() {}
        export async function GET() {}
        export const POST = async () => {};
        export { updateWidget as PUT };
      `,
      "files/[...segments]": "export { GET } from './handler';",
      "(internal)/health": "export async function GET() {}",
    });

    const inventory = discoverApiRouteOperations(projectRoot);

    expect(inventory.routeFiles).toHaveLength(3);
    expect(inventory.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/api/widgets/{widgetId}" }),
        expect.objectContaining({ method: "POST", path: "/api/widgets/{widgetId}" }),
        expect.objectContaining({ method: "PUT", path: "/api/widgets/{widgetId}" }),
        expect.objectContaining({ method: "GET", path: "/api/files/{segments}" }),
        expect.objectContaining({ method: "GET", path: "/api/health" }),
      ])
    );
  });
});

describe("assertOpenApiRouteCoverage", () => {
  it("accepts an exact partition between documented and explicitly excluded operations", () => {
    const projectRoot = createProject({
      widgets: "export async function GET() {}\nexport async function POST() {}",
    });

    const coverage = assertOpenApiRouteCoverage({
      projectRoot,
      documentedOperations: [operation("get", "/api/widgets")],
      exclusions: [
        {
          path: "/api/widgets",
          methods: ["POST"],
          reason: "Mutation volontairement reservee au flux interne de test.",
        },
      ],
    });

    expect(coverage).toEqual({
      routeFiles: 1,
      routeOperations: 2,
      documentedOperations: 1,
      excludedOperations: 1,
    });
  });

  it("fails closed when a route adds an undocumented and non-excluded method", () => {
    const projectRoot = createProject({
      widgets: "export async function GET() {}\nexport async function PATCH() {}",
    });

    expect(() =>
      assertOpenApiRouteCoverage({
        projectRoot,
        documentedOperations: [operation("get", "/api/widgets")],
        exclusions: [],
      })
    ).toThrow(/Route non gouvernee: PATCH \/api\/widgets/);
  });

  it("rejects stale, duplicate, invalid, and documented exclusions", () => {
    const projectRoot = createProject({
      widgets: "export async function GET() {}\nexport async function POST() {}",
    });
    const exclusions = [
      {
        path: "/api/widgets",
        methods: ["GET", "GET"],
        reason: "Cette exclusion duplique volontairement une methode documentee.",
      },
      {
        path: "/api/missing",
        methods: ["POST"],
        reason: "Cette route absente rend volontairement l'exclusion obsolete.",
      },
      {
        path: "/api/widgets",
        methods: ["POST"],
        reason: "court",
      },
      {
        path: "/api/[widgets]",
        methods: ["TRACE"],
        reason: "Cette exclusion emploie volontairement un path et une methode invalides.",
      },
    ] as unknown as readonly OpenApiRouteExclusion[];

    expect(() =>
      assertOpenApiRouteCoverage({
        projectRoot,
        documentedOperations: [operation("get", "/api/widgets")],
        exclusions,
      })
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /Methode dupliquee[\s\S]*Operation a la fois documentee et exclue[\s\S]*Exclusion OpenAPI stale[\s\S]*insuffisamment justifiee[\s\S]*path invalide[\s\S]*methode invalide/
        ),
      })
    );
  });

  it("governs every operation exported by the current repository", () => {
    const coverage = assertOpenApiRouteCoverage({
      projectRoot: process.cwd(),
      documentedOperations: [
        ...openApiOperationsRegistry,
        ...baseAdditionalOpenApiOperationsRegistry,
        ...workflowAdditionalOpenApiOperationsRegistry,
      ],
      exclusions: openApiRouteExclusions,
    });

    expect(coverage.routeFiles).toBeGreaterThan(0);
    expect(coverage.routeOperations).toBe(
      coverage.documentedOperations + coverage.excludedOperations
    );
  });
});
