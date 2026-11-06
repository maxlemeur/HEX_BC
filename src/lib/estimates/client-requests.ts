import { MAX_CENTS } from "@/lib/estimate-calculations";
import { assertNoPendingEstimateBatch } from "@/lib/estimates/batch-intentions";
import { isRecord } from "@/lib/estimates/client-json";
import { EstimateApiError, isEstimateApiError } from "@/lib/estimates/client-errors";
import { requestJsonUncoordinated } from "@/lib/estimates/client-http";
import { parseVersionToken, type EstimateVersionToken, type BulkUpdateEstimateVersionPatch } from "@/lib/estimates/client-version";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { getEstimateEditorMutationIdentity, hasEstimateEditorMutationSession, runEstimateEditorMutation, isOlderEstimateVersionToken } from "@/lib/estimates/editor-mutations";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import { getEstimateDraftLockSessionId } from "@/lib/estimates/draft-lock-session-client";

export async function requestJson<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
  parseResponse?: (value: unknown) => T,
  mutationOptions: {
    /** The endpoint declares its write target; transport never infers it from a URL. */
    mutation?: { versionId: string; structural: boolean; requireAssemblyTotals?: boolean };
    deferVersionPublication?: boolean;
    onAcknowledgedVersion?: (version: EstimateVersionToken) => void;
  } = {}
): Promise<T> {
  const target = mutationOptions.mutation;
  const validate = (value: unknown): T => {
    if (!parseResponse) return value as T;
    try { return parseResponse(value); }
    catch {
      throw new EstimateApiError(
        target ? "La confirmation de l'action est invalide. Relisez le devis avant de recommencer."
          : "Les données reçues sont invalides. Rechargez avant de poursuivre.",
        503, undefined, target ? "BATCH_OUTCOME_UNKNOWN" : "ESTIMATE_READ_INVALID"
      );
    }
  };
  if (!target || !hasEstimateEditorMutationSession(target.versionId)) {
    return validate(await requestJsonUncoordinated<unknown>(path, init, fallbackMessage, Boolean(parseResponse)));
  }
  const initialHeaders = new Headers(init.headers);
  return runEstimateEditorMutation(
    target.versionId,
    initialHeaders.get("If-Match") ?? undefined,
    async (token, scope) => {
      const identity = getEstimateEditorMutationIdentity(target.versionId);
      if (identity) assertNoPendingEstimateBatch(identity);
      const headers = new Headers(initialHeaders);
      headers.set(ESTIMATE_DRAFT_LOCK_SESSION_HEADER, getEstimateDraftLockSessionId(target.versionId));
      let body = init.body;
      if (token) {
        headers.set("If-Match", token);
        if (typeof body === "string") {
          const parsed: unknown = JSON.parse(body);
          if (isRecord(parsed)) {
            if ("updated_at" in parsed) parsed.updated_at = token;
            if ("concurrency_token" in parsed) parsed.concurrency_token = token;
            if ("expected_content_revision" in parsed && token !== initialHeaders.get("If-Match")) {
              const revision = scope.getRevision(token);
              if (revision === undefined) throw new Error("La révision acquittée est manquante. Rechargez le devis avant d'enregistrer.");
              parsed.expected_content_revision = revision;
            }
            body = JSON.stringify(parsed);
          }
        }
      }
      let value: T;
      try {
        value = validate(await requestJsonUncoordinated<unknown>(path, { ...init, headers, body }, fallbackMessage, Boolean(parseResponse)));
      } catch (error) {
        const uncertain = error instanceof TypeError || (isEstimateApiError(error) && error.status >= 500);
        if (!parseResponse || !uncertain) throw error;
        throw scope.requireRead(async () => {
          const refreshed = parseEstimateEditorData(await requestJsonUncoordinated<unknown>(
            `/api/estimates/${target.versionId}`, { method: "GET" },
            "Impossible de vérifier le résultat de l'action.", true
          ), target.versionId);
          return { version: { id: refreshed.version.id, updated_at: refreshed.version.updated_at,
            content_revision: refreshed.version.content_revision }, structural: true, needsReload: true };
        }, "La confirmation de l'action est invalide. Vérifiez le devis avant de recommencer ; aucune écriture n'est relancée.");
      }
      // Older import/assembly endpoints return items only. Refresh inside the
      // same queue, before an autosave or another action can reuse its token.
      const acknowledged = parseVersionToken(value);
      const readVersion = async () => {
        const read = parseVersionToken(await requestJsonUncoordinated<unknown>(
          `/api/estimates/${target.versionId}`, { method: "GET" },
          "Impossible de récupérer la version après l'action.", true
        ));
        if (!read || read.id.toLowerCase() !== target.versionId.toLowerCase() || read.content_revision === undefined) throw new Error("Impossible de récupérer la révision du devis.");
        return read;
      };
      let version = acknowledged;
      if (!version || version.content_revision === undefined) {
        try {
          const read = await readVersion();
          if (acknowledged && (isOlderEstimateVersionToken(read.updated_at, acknowledged.updated_at) ||
            isOlderEstimateVersionToken(acknowledged.updated_at, read.updated_at))) throw new Error("Le devis a changé après la sauvegarde acquittée.");
          version = acknowledged ? { ...acknowledged, content_revision: read.content_revision } : read;
        } catch {
          const readRequired = scope.requireRead(async () => ({ version: await readVersion(), structural: false, needsReload: true }),
            "La sauvegarde a répondu, mais sa révision n'a pas pu être confirmée. Relisez le devis avant de reprendre ; vos saisies sont conservées.");
          if (!acknowledged) throw readRequired;
          // The write is acknowledged. Keep its result so callers do not
          // restore and resend the committed intention while reading is blocked.
          version = acknowledged;
        }
      }
      if (version.id.toLowerCase() !== target.versionId.toLowerCase()) throw new Error("La confirmation appartient à un autre devis.");
      version = { ...version, id: target.versionId };
      mutationOptions.onAcknowledgedVersion?.(version);
      let totals: BulkUpdateEstimateVersionPatch | undefined;
      if (target.requireAssemblyTotals) {
        if (version.id.toLowerCase() !== target.versionId.toLowerCase()) throw new Error("La confirmation appartient à un autre devis.");
        const confirmed = isRecord(value) && isRecord(value.totals) ? value.totals : null;
        const totalHt = confirmed?.total_ht_cents, totalTax = confirmed?.total_tax_cents, totalTtc = confirmed?.total_ttc_cents;
        if (typeof totalHt !== "number" || !Number.isSafeInteger(totalHt) || totalHt < 0 || totalHt > MAX_CENTS ||
          typeof totalTax !== "number" || !Number.isSafeInteger(totalTax) || totalTax < 0 || totalTax > MAX_CENTS ||
          typeof totalTtc !== "number" || !Number.isSafeInteger(totalTtc) || totalTtc < 0 || totalTtc > MAX_CENTS || totalHt + totalTax !== totalTtc) {
          const insertedItemIds = isRecord(value) && Array.isArray(value.items)
            ? value.items.filter((item) => isRecord(item) && typeof item.id === "string" && item.version_id === target.versionId)
              .map((item) => (item as Record<string, unknown>).id) : [];
          throw new EstimateApiError("L'ouvrage a été inséré, mais la confirmation de ses totaux est invalide. Relisez le devis sans le réinsérer.", 409,
            { versionId: target.versionId, insertedItemIds, insertionState: "persisted", financialState: "unknown", retryInsertionAllowed: false },
            "ESTIMATE_ASSEMBLY_INSERT_PERSISTED");
        }
        totals = { total_ht_cents: totalHt, total_tax_cents: totalTax, total_ttc_cents: totalTtc };
      }
      const deletedIds = isRecord(value) && Array.isArray(value.deleted_ids)
        ? value.deleted_ids
        : isRecord(value) && value.committed === true && Array.isArray(value.results)
          ? value.results.flatMap((result) => isRecord(result) && isRecord(result.data) &&
              Array.isArray(result.data.deleted_ids) ? result.data.deleted_ids : [])
          : [];
      return {
        value,
        version,
        structural: target.structural,
        ...(mutationOptions.deferVersionPublication ? { deferVersionPublication: true } : {}),
        totals,
        deletedIds: deletedIds.filter((id): id is string => typeof id === "string"),
      };
    }
  );
}

export async function runEstimateEditorExternalMutation<T>(
  versionId: string,
  action: () => Promise<T>
): Promise<T> {
  if (!hasEstimateEditorMutationSession(versionId)) return action();
  return runEstimateEditorMutation(versionId, undefined, async () => {
    const identity = getEstimateEditorMutationIdentity(versionId);
    if (identity) assertNoPendingEstimateBatch(identity);
    const value = await action();
    const version = parseVersionToken(await requestJsonUncoordinated<unknown>(
      `/api/estimates/${versionId}`, { method: "GET" },
      "Impossible de récupérer la version après l'action."
    ));
    if (!version) throw new Error("Impossible de récupérer le jeton de version.");
    return { value, version, structural: true };
  });
}
