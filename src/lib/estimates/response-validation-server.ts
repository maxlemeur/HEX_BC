import "server-only";

import { internalError } from "@/lib/estimates/errors";

/** A malformed result can follow a committed write; it must never become a 400 request error. */
export function validateEstimateResponse<T>(parse: () => T): T {
  try { return parse(); }
  catch {
    throw internalError("La réponse du serveur est invalide. Relisez le devis avant de poursuivre.");
  }
}
