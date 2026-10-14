import { z } from "zod";

import { coverageCanonicalRequestSchema, coverageErrorResponseSchema, type CoverageRequirement, type CoverageRequirementPayload } from "@/lib/estimates/source-coverage-contracts";
import { SourceReferenceRequestError } from "@/components/estimates/source-reference/source-reference-client";
import type { SourceReferenceScope } from "@/components/estimates/source-reference/source-reference-state";

export const treatmentLabels = { unresolved: "Non arbitré", priced: "Chiffré", included: "Inclus ailleurs", excluded: "Exclu", other_lot: "Autre lot", provisional: "Provisoire" } as const;
export const validityLabels = { unreviewed: "Non revue", current: "À jour", needs_review: "À revérifier" } as const;
export type CoverageCommand = z.infer<typeof coverageCanonicalRequestSchema>;
const intentSchema = z.strictObject({ schemaVersion: z.literal(1), tenantId: z.string().uuid(), command: coverageCanonicalRequestSchema });

export async function coverageJson<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && new TextEncoder().encode(serialized).byteLength > 131072) throw new Error("La demande dépasse la taille autorisée (128 Kio). Réduisez les passages ou les liens.");
  const response = await fetch(url, { method: serialized === undefined ? "GET" : "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    ...(serialized === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: serialized }) });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = coverageErrorResponseSchema.safeParse(value);
    if (error.success) throw new SourceReferenceRequestError(error.data.error.code, error.data.error.message);
    throw new Error("La réponse du serveur est illisible. Aucun résultat n’est déduit de cette réponse.");
  }
  const parsed = z.strictObject({ ok: z.literal(true), data: schema }).safeParse(value);
  if (!parsed.success) throw new Error("La réponse du serveur est incohérente. Actualisez ou reprenez la même demande.");
  return parsed.data.data;
}

function intentKey(scope: SourceReferenceScope) { return `source-coverage:v1:${scope.tenantId}:${scope.actorId}:${scope.versionId}`; }
export function readCoverageIntent(scope: SourceReferenceScope): CoverageCommand | null {
  const raw = sessionStorage.getItem(intentKey(scope));
  if (!raw) return null;
  const parsed = intentSchema.parse(JSON.parse(raw));
  if (parsed.tenantId !== scope.tenantId || parsed.command.actorId !== scope.actorId || parsed.command.versionId !== scope.versionId) throw new Error("Le périmètre de la reprise est incohérent.");
  return parsed.command;
}
export function saveCoverageIntent(scope: SourceReferenceScope, command: CoverageCommand | null) {
  if (!command) { sessionStorage.removeItem(intentKey(scope)); return; }
  const parsed = intentSchema.parse({ schemaVersion: 1, tenantId: scope.tenantId, command });
  if (command.actorId !== scope.actorId || command.versionId !== scope.versionId) throw new Error("Le périmètre de la reprise est incohérent.");
  sessionStorage.setItem(intentKey(scope), JSON.stringify(parsed));
}

export function requirementPayload(value: CoverageRequirement | null): CoverageRequirementPayload {
  if (!value) return { prescription: "", expectedService: "", scope: { mode: "unspecified", zoneId: null, networkId: null, dpgfLotId: null }, completeness: "partial", completenessReason: null, citations: [], links: [] };
  return { prescription: value.prescription, expectedService: value.expectedService, scope: { ...value.scope }, completeness: value.completeness,
    completenessReason: value.completenessReason, citations: value.citations.map(({ id, copyId, page, folio, excerpt }) => ({ id, copyId, page, folio, excerpt })), links: value.links.map((link) => ({ ...link })) };
}

export function commandPath(base: string, command: CoverageCommand) {
  if (command.kind === "dimension") return `${base}/dimensions`;
  if (command.kind === "requirement") return base;
  return `${base}/${command.request.requirementId}/${command.kind === "citation" ? "citations/verify" : "decisions"}`;
}
