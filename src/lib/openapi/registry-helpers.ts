import { z, type ZodTypeAny } from "zod";

export type OpenApiHttpMethod =
  | "get"
  | "head"
  | "options"
  | "post"
  | "put"
  | "patch"
  | "delete";
export type OpenApiSchemaIO = "input" | "output";
export type OpenApiContentType =
  | "application/json"
  | "multipart/form-data"
  | "text/csv"
  | "application/pdf"
  | "application/zip"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type OpenApiSchemaDefinition = {
  schemaName: string;
  schema: ZodTypeAny;
  io?: OpenApiSchemaIO;
};

export type OpenApiParameterDefinition = OpenApiSchemaDefinition & {
  in: "path" | "query" | "header";
  name: string;
  description: string;
  required?: boolean;
};

export type OpenApiRequestBodyDefinition = OpenApiSchemaDefinition & {
  required?: boolean;
  description?: string;
  contentType?: "application/json" | "multipart/form-data";
};

export type OpenApiResponseHeaderDefinition = OpenApiSchemaDefinition & {
  name: string;
  description: string;
  required?: boolean;
};

export type OpenApiResponseContentDefinition = {
  contentType: OpenApiContentType;
  schema?: OpenApiSchemaDefinition;
};

export type OpenApiResponseDefinition = {
  description: string;
  contents?: OpenApiResponseContentDefinition[];
  headers?: OpenApiResponseHeaderDefinition[];
};

export type OpenApiOperationDefinition = {
  method: OpenApiHttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  parameters?: OpenApiParameterDefinition[];
  requestBody?: OpenApiRequestBodyDefinition;
  responses: Record<string, OpenApiResponseDefinition>;
};

export function schemaDefinition(
  name: string,
  schema: ZodTypeAny,
  io: OpenApiSchemaIO = "input"
): OpenApiSchemaDefinition {
  return {
    schemaName: name,
    schema,
    io,
  };
}

export function pathParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
}): OpenApiParameterDefinition {
  return {
    in: "path",
    name: input.name,
    description: input.description,
    required: true,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

export function queryParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiParameterDefinition {
  return {
    in: "query",
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

export function headerParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiParameterDefinition {
  return {
    in: "header",
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

export function responseHeader(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiResponseHeaderDefinition {
  return {
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "output"),
  };
}

export function jsonBody(input: {
  name: string;
  description: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiRequestBodyDefinition {
  return {
    contentType: "application/json",
    required: input.required ?? true,
    description: input.description,
    ...schemaDefinition(input.name, input.schema, "input"),
  };
}

export function multipartBody(input: {
  name: string;
  description: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiRequestBodyDefinition {
  return {
    contentType: "multipart/form-data",
    required: input.required ?? true,
    description: input.description,
    ...schemaDefinition(input.name, input.schema, "input"),
  };
}

export function successEnvelopeSchema(dataSchema: ZodTypeAny) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}

export function successResponseSchemaDefinition(
  schemaName: string,
  dataSchema: ZodTypeAny
): OpenApiSchemaDefinition {
  return schemaDefinition(
    schemaName,
    successEnvelopeSchema(dataSchema),
    "output"
  );
}

export function jsonResponse(
  description: string,
  schema: OpenApiSchemaDefinition = successResponseSchemaDefinition(
    "ApiSuccessUnknown",
    z.unknown()
  )
): OpenApiResponseDefinition {
  return {
    description,
    contents: [
      {
        contentType: "application/json",
        schema,
      },
    ],
  };
}
