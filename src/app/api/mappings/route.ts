import {
  badRequest,
  createMapping,
  findDuplicates,
  listMappings,
  ok,
  previewMapping,
  saveTemplate,
  suggestMapping,
  toErrorResponse,
  validateMapping,
} from "@/lib/mappings/server";
import {
  listMappingsQuerySchema,
  mappingsActionSchema,
} from "@/lib/mappings/schemas";

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest("Parametre limit invalide.");
  }

  return parsed;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const importIdRaw = searchParams.get("import_id");
    const limitRaw = parsePositiveInt(searchParams.get("limit"));

    const query = listMappingsQuerySchema.parse({
      import_id: importIdRaw,
      limit: limitRaw ?? 50,
    });

    const data = await listMappings({
      importId: query.import_id ?? null,
      limit: query.limit,
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    const payload = mappingsActionSchema.parse(body);

    switch (payload.action) {
      case "preview": {
        const data = await previewMapping(payload);
        return ok(data);
      }
      case "suggestions": {
        const data = await suggestMapping(payload);
        return ok(data);
      }
      case "validate": {
        const data = await validateMapping(payload);
        return ok(data);
      }
      case "duplicates": {
        const data = await findDuplicates(payload);
        return ok(data);
      }
      case "create": {
        const data = await createMapping(payload);
        return ok(data, 201);
      }
      case "save-template": {
        const data = await saveTemplate(payload);
        return ok(data, 201);
      }
      default:
        throw badRequest("Action de mapping non supportee.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
