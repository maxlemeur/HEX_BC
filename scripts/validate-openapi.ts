import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  generateOpenApiDocument,
  serializeOpenApiDocument,
  type OpenApiDocument,
} from "../src/lib/openapi/generate";
import { openApiOperationsRegistry } from "../src/lib/openapi/registry";
import { assertOpenApiRouteCoverage } from "../src/lib/openapi/route-coverage";
import { baseAdditionalOpenApiOperationsRegistry } from "../src/lib/openapi/route-contracts";
import { workflowAdditionalOpenApiOperationsRegistry } from "../src/lib/openapi/route-contracts-workflows";
import { openApiRouteExclusions } from "../src/lib/openapi/route-exclusions";

const OPENAPI_FILE = "openapi.json";
const SUCCESS_MESSAGE = "OpenAPI spec valide et synchronisee.";

function normalizeText(value: string): string {
  return `${value.replace(/\r\n/g, "\n").trimEnd()}\n`;
}

function assertOpenApiDocument(document: OpenApiDocument): void {
  if (document.openapi !== "3.1.0") {
    throw new Error(
      `Version OpenAPI attendue "3.1.0", recue "${String(document.openapi)}".`
    );
  }

  if (!document.info?.title || !document.info?.version) {
    throw new Error("Le bloc info doit contenir title et version.");
  }

  const pathEntries = Object.entries(document.paths ?? {});
  if (pathEntries.length === 0) {
    throw new Error("La spec ne contient aucun endpoint (paths vide).");
  }

  pathEntries.forEach(([routePath, pathItem]) => {
    const methods = Object.keys(pathItem ?? {});
    if (methods.length === 0) {
      throw new Error(`Le path "${routePath}" ne contient aucune operation.`);
    }

    methods.forEach((method) => {
      const methodObject = (pathItem as Record<string, unknown>)[method] as
        | Record<string, unknown>
        | undefined;
      const responses = methodObject?.responses as Record<string, unknown> | undefined;

      if (!responses || Object.keys(responses).length === 0) {
        throw new Error(
          `L'operation "${method.toUpperCase()} ${routePath}" n'a aucune reponse.`
        );
      }
    });
  });
}

function main() {
  const projectRoot = process.cwd();
  const openApiPath = path.resolve(projectRoot, OPENAPI_FILE);
  const shouldWrite = process.argv.includes("--write");

  const routeCoverage = assertOpenApiRouteCoverage({
    projectRoot,
    documentedOperations: [
      ...openApiOperationsRegistry,
      ...baseAdditionalOpenApiOperationsRegistry,
      ...workflowAdditionalOpenApiOperationsRegistry,
    ],
    exclusions: openApiRouteExclusions,
  });

  const generatedSpec = generateOpenApiDocument();
  assertOpenApiDocument(generatedSpec);

  const generatedContent = serializeOpenApiDocument(generatedSpec);
  if (shouldWrite) {
    writeFileSync(openApiPath, generatedContent, "utf8");
    console.log(`Spec OpenAPI ecrite dans ${OPENAPI_FILE}.`);
    console.log(
      `Couverture routes/OpenAPI: ${routeCoverage.routeFiles} routes, ${routeCoverage.routeOperations} operations (${routeCoverage.documentedOperations} documentees, ${routeCoverage.excludedOperations} exclues).`
    );
    return;
  }

  if (!existsSync(openApiPath)) {
    throw new Error(
      `${OPENAPI_FILE} introuvable. Lance "node --import tsx scripts/validate-openapi.ts --write".`
    );
  }

  const existingContent = readFileSync(openApiPath, "utf8");
  if (normalizeText(existingContent) !== normalizeText(generatedContent)) {
    throw new Error(
      `${OPENAPI_FILE} n'est pas a jour. Lance "node --import tsx scripts/validate-openapi.ts --write".`
    );
  }

  console.log(SUCCESS_MESSAGE);
  console.log(
    `Couverture routes/OpenAPI: ${routeCoverage.routeFiles} routes, ${routeCoverage.routeOperations} operations (${routeCoverage.documentedOperations} documentees, ${routeCoverage.excludedOperations} exclues).`
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
