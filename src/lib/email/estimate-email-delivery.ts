import "server-only";

import { randomUUID } from "node:crypto";
import { Resend, type ErrorResponse } from "resend";

import type { EstimateEmailDispatch } from "@/lib/email/estimate-email-dispatch-contracts";
import {
  claimEstimateEmailDispatch,
  completeEstimateEmailDispatch,
  deferEstimateEmailDispatch,
  failEstimateEmailDispatch,
  markEstimateEmailDispatchUnknown,
} from "@/lib/email/estimate-email-dispatch-repository";
import { sha256 } from "@/lib/email/estimate-email-hash";
import { conflict, internalError } from "@/lib/estimates/errors";
import { ESTIMATE_DOCUMENTS_BUCKET } from "@/lib/storage/buckets";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const RETRYABLE_RESEND_ERRORS = new Set<ErrorResponse["name"]>([
  "concurrent_idempotent_requests",
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
]);
const AMBIGUOUS_RESEND_ERRORS = new Set<ErrorResponse["name"]>([
  "invalid_idempotent_request",
]);
const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000] as const;

export function classifyResendFailure(error: ErrorResponse) {
  if (AMBIGUOUS_RESEND_ERRORS.has(error.name)) return "unknown" as const;
  if (RETRYABLE_RESEND_ERRORS.has(error.name)) return "retry" as const;
  return "failed" as const;
}

export async function downloadFrozenEstimatePdf(
  dispatch: Pick<EstimateEmailDispatch, "document_path">
): Promise<Buffer> {
  if (!dispatch.document_path) {
    throw internalError("Chemin du PDF fige manquant.");
  }

  const { data, error } = await createServiceRoleClient()
    .storage.from(ESTIMATE_DOCUMENTS_BUCKET)
    .download(dispatch.document_path);

  if (error || !data) {
    throw internalError(
      "Impossible de récupérer le PDF du devis pour l'email.",
      error
    );
  }

  return Buffer.from(await data.arrayBuffer());
}

function assertFrozenProviderPayload(dispatch: EstimateEmailDispatch): asserts dispatch is EstimateEmailDispatch & {
  from_address: string;
  idempotency_key: string;
} {
  if (
    !dispatch.from_address ||
    !dispatch.html_body ||
    !dispatch.text_body ||
    !dispatch.document_path ||
    !dispatch.document_sha256 ||
    !dispatch.attachment_filename ||
    !dispatch.idempotency_key
  ) {
    throw internalError(
      "Le contenu du dispatch email n'est pas complet.",
      undefined,
      "ESTIMATE_EMAIL_PAYLOAD_NOT_PREPARED"
    );
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function deliverEstimateEmailDispatch(input: {
  dispatch: EstimateEmailDispatch;
  actorUserId: string;
  apiKey: string;
  loadPdfBuffer: () => Promise<Buffer>;
  retryDelaysMs?: readonly number[];
}) {
  assertFrozenProviderPayload(input.dispatch);
  const leaseToken = randomUUID();
  const claimed = await claimEstimateEmailDispatch({
    dispatchId: input.dispatch.id,
    tenantId: input.dispatch.tenant_id,
    actorUserId: input.actorUserId,
    leaseToken,
  });

  if (claimed.status === "unknown") {
    throw conflict(
      "L'issue de cet envoi doit être rapprochee avec le fournisseur avant toute reprise.",
      { dispatch_id: claimed.id },
      "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }
  if (["sent", "delivered", "bounced"].includes(claimed.status)) {
    return { providerId: claimed.provider_id };
  }

  assertFrozenProviderPayload(claimed);
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await input.loadPdfBuffer();
    if (sha256(pdfBuffer) !== claimed.document_sha256) {
      throw new Error("The frozen estimate PDF hash no longer matches storage.");
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unable to load the frozen estimate PDF.";
    if (claimed.attempt_count <= 1) {
      await failEstimateEmailDispatch({
        dispatchId: claimed.id,
        tenantId: claimed.tenant_id,
        actorUserId: input.actorUserId,
        leaseToken,
        errorCode: "ESTIMATE_EMAIL_PDF_UNAVAILABLE",
        errorMessage,
      });
    } else {
      await markEstimateEmailDispatchUnknown({
        dispatchId: claimed.id,
        tenantId: claimed.tenant_id,
        actorUserId: input.actorUserId,
        leaseToken,
        errorCode: "ESTIMATE_EMAIL_PDF_MISMATCH_AFTER_ATTEMPT",
        errorMessage,
      });
    }
    throw internalError(
      "Impossible de vérifier le PDF fige avant l'envoi.",
      { dispatch_id: claimed.id },
      claimed.attempt_count <= 1
        ? "ESTIMATE_EMAIL_PDF_UNAVAILABLE"
        : "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }

  const retryDelays = input.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const resend = new Resend(input.apiKey);
  let lastFailure: ErrorResponse | Error | null = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const { data, error } = await resend.emails.send(
        {
          from: claimed.from_address,
          to: claimed.recipient,
          cc: claimed.cc ?? undefined,
          subject: claimed.subject,
          html: claimed.html_body!,
          text: claimed.text_body!,
          attachments: [
            {
              filename: claimed.attachment_filename!,
              content: pdfBuffer.toString("base64"),
            },
          ],
        },
        { idempotencyKey: claimed.idempotency_key }
      );

      if (data?.id) {
        await completeEstimateEmailDispatch({
          dispatchId: claimed.id,
          tenantId: claimed.tenant_id,
          actorUserId: input.actorUserId,
          leaseToken,
          providerId: data.id,
        });
        return { providerId: data.id };
      }

      if (error) {
        const disposition = classifyResendFailure(error);
        if (disposition === "unknown") {
          await markEstimateEmailDispatchUnknown({
            dispatchId: claimed.id,
            tenantId: claimed.tenant_id,
            actorUserId: input.actorUserId,
            leaseToken,
            errorCode: error.name,
            errorMessage: error.message,
          });
          throw conflict(
            "Le fournisseur refuse de rejouer cette clé avec certitude; rapprochement requis.",
            { dispatch_id: claimed.id },
            "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
          );
        }

        if (disposition === "failed") {
          await failEstimateEmailDispatch({
            dispatchId: claimed.id,
            tenantId: claimed.tenant_id,
            actorUserId: input.actorUserId,
            leaseToken,
            errorCode: error.name,
            errorMessage: error.message,
          });
          throw internalError(
            "Erreur lors de l'envoi de l'email.",
            { provider_error: error.name },
            "ESTIMATE_EMAIL_PROVIDER_REJECTED"
          );
        }

        lastFailure = error;
      } else {
        lastFailure = new Error("Resend returned neither data nor error.");
      }
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ((error as { code?: string }).code === "ESTIMATE_EMAIL_DELIVERY_UNKNOWN" ||
          (error as { code?: string }).code === "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE")
      ) {
        // A receipt rejected after provider acceptance is not a retryable
        // transport failure: stop here and retain the same persisted request.
        throw error;
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "ESTIMATE_EMAIL_PROVIDER_REJECTED"
      ) {
        throw error;
      }
      lastFailure = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < retryDelays.length) {
      await delay(retryDelays[attempt]);
    }
  }

  const failureCode =
    lastFailure && "name" in lastFailure ? lastFailure.name : "EMAIL_PROVIDER_UNAVAILABLE";
  const failureMessage =
    lastFailure instanceof Error
      ? lastFailure.message
      : (lastFailure?.message ?? "Email provider unavailable.");
  const deferred = await deferEstimateEmailDispatch({
    dispatchId: claimed.id,
    tenantId: claimed.tenant_id,
    actorUserId: input.actorUserId,
    leaseToken,
    errorCode: failureCode,
    errorMessage: failureMessage,
  });

  if (deferred.status === "unknown") {
    throw conflict(
      "La fenêtre de rejeu automatique est expiree; rapprochement fournisseur requis.",
      { dispatch_id: deferred.id },
      "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }

  throw internalError(
    "Le fournisseur email est temporairement indisponible. Réessayez avec la même demande.",
    { dispatch_id: deferred.id },
    "ESTIMATE_EMAIL_RETRYABLE"
  );
}
