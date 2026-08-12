import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import type { OpenApiOperationDefinition } from "@/lib/openapi/registry";

export const NEXT_ROUTE_HTTP_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

export type NextRouteHttpMethod = (typeof NEXT_ROUTE_HTTP_METHODS)[number];

export type ApiRouteOperation = {
  method: NextRouteHttpMethod;
  path: string;
  sourceFile: string;
};

export type OpenApiRouteExclusion = {
  path: `/api/${string}`;
  methods: readonly NextRouteHttpMethod[];
  reason: string;
};

export type OpenApiRouteCoverage = {
  routeFiles: number;
  routeOperations: number;
  documentedOperations: number;
  excludedOperations: number;
};

const HTTP_METHOD_SET = new Set<string>(NEXT_ROUTE_HTTP_METHODS);
const MINIMUM_EXCLUSION_REASON_LENGTH = 20;

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      )
  );
}

function toHttpMethod(value: string): NextRouteHttpMethod | null {
  return HTTP_METHOD_SET.has(value) ? (value as NextRouteHttpMethod) : null;
}

function collectExportedHttpMethods(sourceText: string, sourceFile: string) {
  const parsed = ts.createSourceFile(
    sourceFile,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const methods = new Set<NextRouteHttpMethod>();

  parsed.statements.forEach((statement) => {
    if (
      ts.isFunctionDeclaration(statement) &&
      hasExportModifier(statement) &&
      statement.name
    ) {
      const method = toHttpMethod(statement.name.text);
      if (method) methods.add(method);
      return;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      statement.declarationList.declarations.forEach((declaration) => {
        if (!ts.isIdentifier(declaration.name)) return;
        const method = toHttpMethod(declaration.name.text);
        if (method) methods.add(method);
      });
      return;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      statement.exportClause.elements.forEach((element) => {
        const method = toHttpMethod(element.name.text);
        if (method) methods.add(method);
      });
    }
  });

  return [...methods].sort(
    (left, right) =>
      NEXT_ROUTE_HTTP_METHODS.indexOf(left) -
      NEXT_ROUTE_HTTP_METHODS.indexOf(right)
  );
}

function listRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listRouteFiles(entryPath);
    return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
  });
}

function routeFileToOpenApiPath(apiDirectory: string, routeFile: string): string {
  const relativeDirectory = path
    .relative(apiDirectory, path.dirname(routeFile))
    .split(path.sep)
    .filter(Boolean)
    .filter(
      (segment) =>
        !(segment.startsWith("(") && segment.endsWith(")")) &&
        !segment.startsWith("@")
    )
    .map((segment) => {
      const optionalCatchAll = segment.match(/^\[\[\.\.\.([^\]]+)\]\]$/);
      if (optionalCatchAll) return `{${optionalCatchAll[1]}}`;

      const dynamic = segment.match(/^\[(?:\.\.\.)?([^\]]+)\]$/);
      return dynamic ? `{${dynamic[1]}}` : segment;
    });

  return `/api${relativeDirectory.length > 0 ? `/${relativeDirectory.join("/")}` : ""}`;
}

export function discoverApiRouteOperations(projectRoot: string): {
  routeFiles: string[];
  operations: ApiRouteOperation[];
} {
  const apiDirectory = path.join(projectRoot, "src", "app", "api");
  const routeFiles = listRouteFiles(apiDirectory).sort((left, right) =>
    left.localeCompare(right)
  );
  const operations: ApiRouteOperation[] = [];

  routeFiles.forEach((routeFile) => {
    const sourceFile = path.relative(projectRoot, routeFile).replaceAll("\\", "/");
    const methods = collectExportedHttpMethods(
      readFileSync(routeFile, "utf8"),
      sourceFile
    );

    if (methods.length === 0) {
      throw new Error(
        `Le fichier de route "${sourceFile}" n'exporte aucune methode HTTP Next.js reconnue.`
      );
    }

    const routePath = routeFileToOpenApiPath(apiDirectory, routeFile);
    methods.forEach((method) => {
      operations.push({ method, path: routePath, sourceFile });
    });
  });

  return { routeFiles, operations };
}

function operationKey(method: string, routePath: string): string {
  return `${method.toUpperCase()} ${routePath}`;
}

export function assertOpenApiRouteCoverage(input: {
  projectRoot: string;
  documentedOperations: readonly OpenApiOperationDefinition[];
  exclusions: readonly OpenApiRouteExclusion[];
}): OpenApiRouteCoverage {
  const inventory = discoverApiRouteOperations(input.projectRoot);
  const actualByKey = new Map(
    inventory.operations.map((operation) => [
      operationKey(operation.method, operation.path),
      operation,
    ])
  );
  const documentedKeys = new Set<string>();
  const exclusionKeys = new Set<string>();
  const failures: string[] = [];

  inventory.operations.forEach((operation, index) => {
    const key = operationKey(operation.method, operation.path);
    const duplicate = inventory.operations
      .slice(0, index)
      .find(
        (candidate) =>
          operationKey(candidate.method, candidate.path) === key
      );
    if (duplicate) {
      failures.push(
        `Operation exportee par plusieurs fichiers de route: ${key} (${duplicate.sourceFile}, ${operation.sourceFile}).`
      );
    }
  });

  input.documentedOperations.forEach((operation) => {
    const key = operationKey(operation.method, operation.path);
    if (documentedKeys.has(key)) {
      failures.push(`Operation OpenAPI dupliquee: ${key}.`);
    }
    documentedKeys.add(key);

    if (!actualByKey.has(key)) {
      failures.push(`Operation OpenAPI sans route exportee: ${key}.`);
    }
  });

  input.exclusions.forEach((exclusion) => {
    if (!exclusion.path.startsWith("/api/") || exclusion.path.includes("[")) {
      failures.push(`Exclusion OpenAPI avec path invalide: ${exclusion.path}.`);
    }
    if (exclusion.methods.length === 0) {
      failures.push(`Exclusion OpenAPI sans methode: ${exclusion.path}.`);
    }
    if (exclusion.reason.trim().length < MINIMUM_EXCLUSION_REASON_LENGTH) {
      failures.push(
        `Exclusion OpenAPI insuffisamment justifiee: ${exclusion.path}.`
      );
    }

    const methodsForPath = new Set<NextRouteHttpMethod>();
    exclusion.methods.forEach((method) => {
      if (!HTTP_METHOD_SET.has(method)) {
        failures.push(
          `Exclusion OpenAPI avec methode invalide: ${method} ${exclusion.path}.`
        );
      }
      if (methodsForPath.has(method)) {
        failures.push(
          `Methode dupliquee dans une exclusion OpenAPI: ${method} ${exclusion.path}.`
        );
      }
      methodsForPath.add(method);

      const key = operationKey(method, exclusion.path);
      if (exclusionKeys.has(key)) {
        failures.push(`Exclusion OpenAPI dupliquee: ${key}.`);
      }
      exclusionKeys.add(key);

      if (!actualByKey.has(key)) {
        failures.push(`Exclusion OpenAPI stale: ${key}.`);
      }
      if (documentedKeys.has(key)) {
        failures.push(`Operation a la fois documentee et exclue: ${key}.`);
      }
    });
  });

  inventory.operations.forEach((operation) => {
    const key = operationKey(operation.method, operation.path);
    if (!documentedKeys.has(key) && !exclusionKeys.has(key)) {
      failures.push(
        `Route non gouvernee: ${key} (${operation.sourceFile}). Ajoutez-la au registre OpenAPI ou a la liste d'exclusions justifiees.`
      );
    }
  });

  if (failures.length > 0) {
    throw new Error(
      `Couverture routes/OpenAPI invalide (${failures.length} erreur(s)):\n- ${failures.join("\n- ")}`
    );
  }

  return {
    routeFiles: inventory.routeFiles.length,
    routeOperations: inventory.operations.length,
    documentedOperations: documentedKeys.size,
    excludedOperations: exclusionKeys.size,
  };
}
