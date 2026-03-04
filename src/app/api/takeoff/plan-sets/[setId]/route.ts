import { z } from "zod";

import {
  badRequest,
  mapSupabaseError,
  notFound,
  ok,
  toErrorResponse,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { deletePlanSet, getPlanSet, planSetIdSchema } from "@/lib/takeoff/plans";

const paramsSchema = z
  .object({
    setId: planSetIdSchema,
  })
  .strict();

const optionalNullableDescriptionSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().max(2000, "Description trop longue.").nullable().optional()
);

const metadataSchema = z.record(z.string(), z.unknown());

const updatePlanSetSchema = z
  .object({
    name: z.string().trim().min(1, "Champ obligatoire.").max(255, "Nom trop long.").optional(),
    description: optionalNullableDescriptionSchema,
    metadata: metadataSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      !Object.prototype.hasOwnProperty.call(input, "name") &&
      !Object.prototype.hasOwnProperty.call(input, "description") &&
      !Object.prototype.hasOwnProperty.call(input, "metadata")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Au moins un champ de mise a jour est requis.",
      });
    }
  });

type UpdatePlanSetInput = z.infer<typeof updatePlanSetSchema>;

async function getSetId(paramsPromise: Promise<{ setId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).setId;
}

function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function parseUpdatePlanSetPayload(payload: unknown): UpdatePlanSetInput {
  const parsed = updatePlanSetSchema.safeParse(payload);

  if (!parsed.success) {
    throw unprocessableEntity(
      "Payload invalide.",
      {
        issues: toValidationIssues(parsed.error),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

async function updatePlanSetById(setId: string, input: UpdatePlanSetInput) {
  const { supabase, tenantId } = await getAuthenticatedContext();
  await assertTakeoffEnabled(tenantId, {
    supabase,
  });

  const updatePayload: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(input, "name")) {
    updatePayload.name = input.name;
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    updatePayload.description = input.description ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "metadata")) {
    updatePayload.metadata = input.metadata;
  }

  const { data, error } = await supabase
    .from("plan_sets" as never)
    .update(updatePayload as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, setId as never)
    .select("id")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le jeu de plans.");
  }

  if (!data) {
    throw notFound(
      "Jeu de plans introuvable.",
      {
        set_id: setId,
      },
      "PLAN_SET_NOT_FOUND"
    );
  }

  return getPlanSet(setId);
}

async function handleUpdate(
  request: Request,
  paramsPromise: Promise<{ setId: string }>
) {
  const setId = await getSetId(paramsPromise);
  const payload = parseUpdatePlanSetPayload(await parseJsonBody(request));
  return updatePlanSetById(setId, payload);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const setId = await getSetId(params);
    const data = await deletePlanSet(setId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const setId = await getSetId(params);
    const data = await getPlanSet(setId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const data = await handleUpdate(request, params);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const data = await handleUpdate(request, params);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
