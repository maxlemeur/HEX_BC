import { type EstimateVersionToken, type BulkUpdateEstimateVersionPatch, parseVersionToken } from "@/lib/estimates/client-version";
import { requestJsonUncoordinated } from "@/lib/estimates/client-http";
import { fetchEstimateEditorData } from "@/lib/estimates/editor-read-client";
import type { EstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import type { EstimateBatchOperationResult } from "@/lib/estimates/batch-contracts";
import type { EstimateBatchAttempt, EstimateBatchIdentity } from "@/lib/estimates/batch-intentions";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import { getEstimateEditorMutationIdentity, runEstimateEditorMutation, isOlderEstimateVersionToken } from "@/lib/estimates/editor-mutations";
import type { Database } from "@/types/database";
import { toCreateEstimateItemBody } from "@/lib/estimates/items-client";

export type EstimateBatchOperation =
  | {
      op: "create";
      data: Database["public"]["Tables"]["estimate_items"]["Insert"];
    }
  | {
      op: "update";
      id: string;
      data: Database["public"]["Tables"]["estimate_items"]["Update"] & { assembly_quantity?: number };
    }
  | {
      op: "delete";
      id: string;
    }
  | {
      op: "reorder";
      data: {
        parent_id?: string | null;
        ordered_ids: string[];
      };
    };

export type EstimateBatchResult = {
  committed: boolean;
  results: EstimateBatchOperationResult[];
  versionToken: EstimateVersionToken;
  totals?: BulkUpdateEstimateVersionPatch;
  currentVersionToken?: EstimateVersionToken;
  replayed?: boolean;
  receipt?: { operationKey: string; actorId: string; versionId: string; expectedUpdatedAt: string; committedAt: string };
};

export async function batchEstimateOperations(
  versionId: string,
  updatedAtToken: string,
  operations: EstimateBatchOperation[],
  options: { dryRun?: boolean; attempt?: EstimateBatchAttempt; onPrepared?: (data: EstimateEditorData) => void } = {}
): Promise<EstimateBatchResult> {
  // Load the receipt/parser only for batch work; the editor's initial bundle
  // does not need the recovery implementation to display a quote.
  const publicOperations = operations.map((operation) => operation.op === "create"
    ? { op: "create" as const, data: toCreateEstimateItemBody(operation.data) }
    : operation);
  const operationsSnapshot = JSON.parse(JSON.stringify(publicOperations)) as BatchOperationInput[];
  return runEstimateEditorMutation(versionId, updatedAtToken, async (token, scope) => {
    const { executeClientEstimateBatch } = await import("@/lib/estimates/batch-client");
    const result = await executeClientEstimateBatch({
      transport: (path, init, message) => requestJsonUncoordinated(path, init, message, true),
      versionId, updatedAtToken: token ?? updatedAtToken,
      operations: operationsSnapshot, ...options,
    });
    if (result.value.committed && operations.some(operation => operation.op === "update" && operation.data.assembly_quantity !== undefined)) {
      const identity = getEstimateEditorMutationIdentity(versionId);
      // Publish the new token together with all resized components. A failed read
      // must keep the mutation queue blocked rather than permit stale row writes.
      const read = async () => {
        if (JSON.stringify(getEstimateEditorMutationIdentity(versionId)) !== JSON.stringify(identity)) throw new Error("Le compte ou le devis a changé.");
        const refreshed = await fetchEstimateEditorData(versionId);
        if (!scope.isActive() || JSON.stringify(getEstimateEditorMutationIdentity(versionId)) !== JSON.stringify(identity)) throw new Error("L’éditeur a changé.");
        if (refreshed.version.id !== versionId || isOlderEstimateVersionToken(refreshed.version.updated_at, result.version.updated_at)) throw new Error("La relecture du devis est périmée.");
        options.onPrepared?.(refreshed);
        return {
          version: { id: refreshed.version.id, updated_at: refreshed.version.updated_at, content_revision: refreshed.version.content_revision },
          structural: true, deferVersionPublication: Boolean(options.onPrepared), needsReload: !options.onPrepared,
          totals: { total_ht_cents: refreshed.version.total_ht_cents, total_tax_cents: refreshed.version.total_tax_cents, total_ttc_cents: refreshed.version.total_ttc_cents },
        };
      };
      try { return { ...result, ...await read() }; }
      catch { throw scope.requireRead(read, "La quantité est enregistrée, mais la relecture des composants a échoué. Vérifiez le résultat avant de poursuivre."); }
    }
    if (result.value.committed && result.version.content_revision === undefined) {
      const readVersion = async () => {
        const read = parseVersionToken(await requestJsonUncoordinated<unknown>(
          `/api/estimates/${versionId}`, { method: "GET" }, "Impossible de confirmer la révision des lignes."
        ));
        if (!read || read.id !== versionId || read.content_revision === undefined) throw new Error("La révision du devis est manquante.");
        return read;
      };
      try {
        const read = await readVersion();
        if (isOlderEstimateVersionToken(read.updated_at, result.version.updated_at) ||
          isOlderEstimateVersionToken(result.version.updated_at, read.updated_at)) throw new Error("Le devis a changé après la sauvegarde des lignes.");
        result.version = { ...result.version, content_revision: read.content_revision };
      } catch {
        scope.requireRead(async () => ({ version: await readVersion(), structural: false, needsReload: true }),
          "Les lignes ont été sauvegardées, mais leur révision n'a pas pu être confirmée. Relisez le devis avant de reprendre ; vos saisies sont conservées.");
      }
    }
    return result;
  });
}

export async function inspectEstimateBatchReceipt(identity: EstimateBatchIdentity) {
  const { inspectClientEstimateBatch } = await import("@/lib/estimates/batch-client");
  return inspectClientEstimateBatch((path, init, message) => requestJsonUncoordinated(path, init, message, true), identity);
}

export async function resumeEstimateBatchOperation(identity: EstimateBatchIdentity) {
  const { resumeClientEstimateBatch } = await import("@/lib/estimates/batch-client");
  return resumeClientEstimateBatch((path, init, message) => requestJsonUncoordinated(path, init, message, true), identity);
}
