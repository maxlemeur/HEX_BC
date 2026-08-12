import { z } from "zod";

import {
  openApiOperationsRegistry,
  openApiSharedSchemaDefinitions,
  type OpenApiOperationDefinition,
  type OpenApiResponseDefinition,
  type OpenApiSchemaDefinition,
} from "@/lib/openapi/registry";
import { baseAdditionalOpenApiOperationsRegistry } from "@/lib/openapi/route-contracts";
import type { MultiContentRequestBodyDefinition } from "@/lib/openapi/route-contracts";
import { workflowAdditionalOpenApiOperationsRegistry } from "@/lib/openapi/route-contracts-workflows";

type OpenApiMethodObject = Record<string, unknown>;
type OpenApiPathItemObject = Partial<
  Record<
    "get" | "head" | "options" | "post" | "put" | "patch" | "delete",
    OpenApiMethodObject
  >
>;
type OpenApiPathsObject = Record<string, OpenApiPathItemObject>;

export type OpenApiDocument = {
  openapi: "3.1.0";
  jsonSchemaDialect: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  tags: Array<{
    name: string;
  }>;
  paths: OpenApiPathsObject;
  components: {
    schemas: Record<string, unknown>;
  };
};

export type GenerateOpenApiOptions = {
  title?: string;
  version?: string;
  description?: string;
  serverUrl?: string;
};

const JSON_SCHEMA_DIALECT = "https://spec.openapis.org/oas/3.1/dialect/base";
const METHOD_ORDER: Record<
  "get" | "head" | "options" | "post" | "put" | "patch" | "delete",
  number
> = {
  get: 0,
  head: 1,
  options: 2,
  post: 3,
  put: 4,
  patch: 5,
  delete: 6,
};

const DEFAULT_ERROR_RESPONSES: Array<{
  status: "400" | "401" | "403" | "404" | "409" | "500";
  description: string;
}> = [
  {
    status: "400",
    description: "Requete invalide ou payload non conforme.",
  },
  {
    status: "401",
    description: "Authentification requise.",
  },
  {
    status: "403",
    description: "Acces interdit.",
  },
  {
    status: "404",
    description: "Ressource introuvable.",
  },
  {
    status: "409",
    description: "Conflit metier ou de concurrence.",
  },
  {
    status: "500",
    description: "Erreur interne serveur.",
  },
];

type BuildState = {
  schemas: Record<string, unknown>;
};

function sortOperations(
  operations: OpenApiOperationDefinition[]
): OpenApiOperationDefinition[] {
  return [...operations].sort((left, right) => {
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }

    return METHOD_ORDER[left.method] - METHOD_ORDER[right.method];
  });
}

function removeSchemaDialectKeyword(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeSchemaDialectKeyword);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  Object.entries(source).forEach(([key, nestedValue]) => {
    if (key === "$schema") {
      return;
    }

    output[key] = removeSchemaDialectKeyword(nestedValue);
  });

  return output;
}

function toJsonSchema(definition: OpenApiSchemaDefinition): Record<string, unknown> {
  const rawJsonSchema = z.toJSONSchema(definition.schema, {
    io: definition.io ?? "input",
    target: "draft-2020-12",
    unrepresentable: "any",
    reused: "inline",
  });

  return removeSchemaDialectKeyword(rawJsonSchema) as Record<string, unknown>;
}

function ensureSchemaRef(
  state: BuildState,
  definition: OpenApiSchemaDefinition
): Record<string, string> {
  if (!state.schemas[definition.schemaName]) {
    state.schemas[definition.schemaName] = toJsonSchema(definition);
  }

  return {
    $ref: `#/components/schemas/${definition.schemaName}`,
  };
}

function buildResponse(
  state: BuildState,
  response: OpenApiResponseDefinition
): Record<string, unknown> {
  const responseObject: Record<string, unknown> = {
    description: response.description,
  };

  if (response.headers && response.headers.length > 0) {
    const headers: Record<string, unknown> = {};

    response.headers.forEach((header) => {
      headers[header.name] = {
        description: header.description,
        required: header.required ?? false,
        schema: ensureSchemaRef(state, header),
      };
    });

    responseObject.headers = headers;
  }

  if (response.contents && response.contents.length > 0) {
    const content: Record<string, unknown> = {};

    response.contents.forEach((entry) => {
      if (
        !entry.schema &&
        (entry.contentType === "application/pdf" ||
          entry.contentType === "application/zip" ||
          entry.contentType ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      ) {
        content[entry.contentType] = {
          schema: {
            type: "string",
            format: "binary",
          },
        };
        return;
      }

      if (!entry.schema) {
        content[entry.contentType] = {};
        return;
      }

      content[entry.contentType] = {
        schema: ensureSchemaRef(state, entry.schema),
      };
    });

    responseObject.content = content;
  }

  return responseObject;
}

function buildOperation(
  state: BuildState,
  operation: OpenApiOperationDefinition
): OpenApiMethodObject {
  const operationObject: OpenApiMethodObject = {
    tags: operation.tags,
    summary: operation.summary,
    description: operation.description,
  };

  if (operation.parameters && operation.parameters.length > 0) {
    operationObject.parameters = operation.parameters.map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      description: parameter.description,
      required: parameter.in === "path" ? true : parameter.required ?? false,
      schema: ensureSchemaRef(state, parameter),
    }));
  }

  if (operation.requestBody) {
    const contentType = operation.requestBody.contentType ?? "application/json";
    const content: Record<string, unknown> = {
      [contentType]: {
        schema: ensureSchemaRef(state, operation.requestBody),
      },
    };
    const multiContentBody = operation.requestBody as MultiContentRequestBodyDefinition;
    multiContentBody.additionalContents?.forEach((entry) => {
      content[entry.contentType] = {
        schema: ensureSchemaRef(state, entry.schema),
      };
    });
    operationObject.requestBody = {
      description: operation.requestBody.description,
      required: operation.requestBody.required ?? true,
      content,
    };
  }

  const mergedResponses: Record<string, OpenApiResponseDefinition> = {
    ...operation.responses,
  };

  DEFAULT_ERROR_RESPONSES.forEach((entry) => {
    if (mergedResponses[entry.status]) {
      return;
    }

    mergedResponses[entry.status] = {
      description: entry.description,
      contents: [
        {
          contentType: "application/json",
          schema: openApiSharedSchemaDefinitions.apiFailureResponse,
        },
      ],
    };
  });

  const responseEntries = Object.entries(mergedResponses).sort((left, right) => {
    return Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10);
  });

  const responses: Record<string, unknown> = {};
  responseEntries.forEach(([status, response]) => {
    responses[status] = buildResponse(state, response);
  });

  operationObject.responses = responses;
  return operationObject;
}

function buildTags(operations: OpenApiOperationDefinition[]): Array<{ name: string }> {
  const tags: string[] = [];

  operations.forEach((operation) => {
    operation.tags.forEach((tag) => {
      if (tags.includes(tag)) {
        return;
      }

      tags.push(tag);
    });
  });

  return tags.map((name) => ({
    name,
  }));
}

export function generateOpenApiDocument(
  options: GenerateOpenApiOptions = {}
): OpenApiDocument {
  const state: BuildState = {
    schemas: {},
  };

  Object.values(openApiSharedSchemaDefinitions).forEach((schemaDefinition) => {
    ensureSchemaRef(state, schemaDefinition);
  });

  const sortedOperations = sortOperations([
    ...openApiOperationsRegistry,
    ...baseAdditionalOpenApiOperationsRegistry,
    ...workflowAdditionalOpenApiOperationsRegistry,
  ]);
  const paths: OpenApiPathsObject = {};

  sortedOperations.forEach((operation) => {
    if (!paths[operation.path]) {
      paths[operation.path] = {};
    }

    paths[operation.path][operation.method] = buildOperation(state, operation);
  });

  return {
    openapi: "3.1.0",
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    info: {
      title: options.title ?? "BC - API Chiffrage",
      version: options.version ?? "1.0.0",
      description:
        options.description ??
        "Documentation OpenAPI auto-generee depuis les schemas Zod existants.",
    },
    servers: [
      {
        url: options.serverUrl ?? "/",
        description: "URL relative de l'instance courante",
      },
    ],
    tags: buildTags(sortedOperations),
    paths,
    components: {
      schemas: state.schemas,
    },
  };
}

export function serializeOpenApiDocument(
  document: OpenApiDocument = generateOpenApiDocument()
): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
