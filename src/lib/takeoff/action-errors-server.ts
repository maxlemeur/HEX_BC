import "server-only";

import { ZodError } from "zod";
import { ApiError } from "@/lib/estimates/errors";
import { TakeoffError } from "@/lib/takeoff/errors";
import { TakeoffPreparationNotReadyError } from "@/lib/takeoff/preparation";
import type { SafeTakeoffActionResult, TakeoffActionFailure } from "@/lib/takeoff/action-result";

const DEFAULT_FAILURE_MESSAGE = "Impossible de terminer cette étape. Rechargez la préparation pour retrouver les réponses enregistrées, puis réessayez.";

function expectedFailure(error: unknown, failureMessage: string): TakeoffActionFailure {
  if (error instanceof TakeoffError && error.status === 503 &&
      typeof error.details === "object" && error.details !== null &&
      "reason" in error.details && error.details.reason === "PREPARATION_SCHEMA_REQUIRED") {
    return { status: 503, code: "TAKEOFF_PREPARATION_SCHEMA_REQUIRED",
      message: "La préparation du métré nécessite la mise à jour de la base de données. Contactez l'administrateur.", retryable: false };
  }
  if (error instanceof TakeoffPreparationNotReadyError) {
    return { status: 422, code: "TAKEOFF_PREPARATION_INCOMPLETE", message: error.message, retryable: false };
  }
  if (error instanceof ApiError && error.status < 500) {
    return {
      status: error.status, code: error.code,
      message: error.status === 401 ? "Votre session a expiré. Reconnectez-vous pour retrouver la préparation." : error.message,
      retryable: error instanceof TakeoffError ? error.retryable : false,
    };
  }
  if (error instanceof ZodError) {
    return { status: 400, code: "VALIDATION_ERROR", message: "La demande est invalide. Vérifiez les champs de la préparation avant de continuer.", retryable: false };
  }
  return { status: 503, code: "TAKEOFF_ACTION_UNAVAILABLE", message: failureMessage, retryable: true };
}

/** Public error contract: no stack, SQL details, credentials or arbitrary exception text. */
export async function runSafeTakeoffAction<T>(
  operation: () => Promise<T>,
  failureMessage = DEFAULT_FAILURE_MESSAGE
): Promise<SafeTakeoffActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: expectedFailure(error, failureMessage) };
  }
}
