import {
  badRequest,
  createMapping,
  findDuplicates,
  listMappings,
  ok,
  previewMapping,
  previewImportStructure,
  saveTemplate,
  suggestMapping,
  toErrorResponse,
  validateMapping,
} from "@/lib/mappings/server";
import {
  listMappingsQuerySchema,
  mappingsActionSchema,
} from "@/lib/mappings/schemas";
import { parseJsonBody, parsePositiveIntParam } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const importIdRaw = searchParams.get("import_id");
    const limitRaw = parsePositiveIntParam(searchParams.get("limit"), badRequest);

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
    const body = await parseJsonBody(request, badRequest);
    const payload = mappingsActionSchema.parse(body);

    switch (payload.action) {
      case "preview": {
        const data = await previewMapping(payload);
        return ok(data);
      }
      case "structure-preview": {
        const data = await previewImportStructure(payload);
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
        // The identifiers of the rows written stay on the server (an import confirmation binds them).
        const { mapped_row_ids: _mappedRowIds, ...data } = await createMapping(payload);
        void _mappedRowIds;
        return ok(data, 201);
      }
      case "save-template": {
        const data = await saveTemplate(payload);
        return ok(data, 201);
      }
      default:
        throw badRequest("Action de mapping non prise en charge.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
