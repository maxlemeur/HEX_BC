import { z } from "zod";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  getEstimateEmailDispatchForReconciliation,
  reconcileEstimateEmailDispatch,
} from "@/lib/email/estimate-email-outbox";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";

export const runtime = "nodejs";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

const reconcileBodySchema = z.discriminatedUnion("resolution", [
  z.object({
    dispatchId: z.string().uuid("dispatchId invalide."),
    resolution: z.literal("sent"),
    // Marking a dispatch as sent is irreversible and drives the version to
    // `sent`: the operator must provide the provider message id as evidence.
    providerId: z
      .string()
      .trim()
      .min(1, "L'identifiant fournisseur est requis pour marquer l'envoi.")
      .max(200),
  }),
  z.object({
    dispatchId: z.string().uuid("dispatchId invalide."),
    resolution: z.literal("failed"),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = versionIdParamSchema.parse(await params);
    const body = reconcileBodySchema.parse(
      await request.json().catch(() => {
        throw badRequest("Payload JSON invalide.");
      })
    );
    const { userId, tenantId, isTenantAdmin } =
      await getAuthenticatedTenantContext();
    if (!isTenantAdmin) {
      throw forbidden(
        "Le rapprochement d'un envoi email est reserve aux administrateurs."
      );
    }

    const dispatch = await getEstimateEmailDispatchForReconciliation(
      body.dispatchId
    );
    if (
      !dispatch ||
      dispatch.tenant_id !== tenantId ||
      dispatch.version_id !== versionId
    ) {
      throw notFound("Envoi email introuvable pour ce devis.");
    }

    const data = await reconcileEstimateEmailDispatch({
      dispatchId: dispatch.id,
      resolution: body.resolution,
      actorUserId: userId,
      providerId: body.resolution === "sent" ? body.providerId : null,
      note: `reconcile:${versionId}`,
    });
    return ok({
      id: data.id,
      status: data.status,
      versionId,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
