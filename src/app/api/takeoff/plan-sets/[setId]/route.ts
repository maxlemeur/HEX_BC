import { z } from "zod";

import {
  badRequest,
  mapSupabaseError,
  notFound,
  ok,
  toErrorResponse,
} from "@/lib/http/api-response";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { deletePlanSet, getPlanSet, planSetIdSchema } from "@/lib/takeoff/plans";
import { parseJsonBody } from "@/lib/http/request";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";

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
        message: "Au moins un champ de mise à jour est requis.",
      });
    }
  });

type UpdatePlanSetInput = z.infer<typeof updatePlanSetSchema>;

async function getSetId(paramsPromise: Promise<{ setId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).setId;
}

function parseUpdatePlanSetPayload(payload: unknown): UpdatePlanSetInput {
  return parseWithSchema(updatePlanSetSchema, payload, "Payload invalide.");
}

async function updatePlanSetById(setId: string, input: UpdatePlanSetInput) {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();

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
    throw mapSupabaseError(error, "Impossible de mettre à jour le jeu de plans.");
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
  const payload = parseUpdatePlanSetPayload(await parseJsonBody(request, badRequest));
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
