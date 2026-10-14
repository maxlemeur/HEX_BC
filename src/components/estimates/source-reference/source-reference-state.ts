import { z } from "zod";

import {
  sourceReferenceConfirmationRequestSchema,
  sourceReferencePreparationInputSchema,
  sourceReferenceUuidSchema,
} from "@/lib/estimates/source-reference-contracts";

export type SourceReferenceScope = {
  actorId: string;
  tenantId: string;
  versionId: string;
};

export type SourceReferenceDocument = {
  id: string;
  fileName: string;
  createdAt: string;
  byteSize: number;
};

export type SourceReferenceDocuments = {
  items: SourceReferenceDocument[];
  page: number;
  hasNext: boolean;
  state: "ready" | "readonly" | "error";
};

const intentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  actorId: sourceReferenceUuidSchema,
  tenantId: sourceReferenceUuidSchema,
  versionId: sourceReferenceUuidSchema,
  preparation: sourceReferencePreparationInputSchema.nullable(),
  copyId: sourceReferenceUuidSchema.nullable(),
  confirmation: sourceReferenceConfirmationRequestSchema.nullable(),
});

export type SourceReferenceIntent = z.infer<typeof intentSchema>;

function storageKey(scope: SourceReferenceScope) {
  return `source-reference:v1:${scope.tenantId}:${scope.actorId}:${scope.versionId}`;
}

export function emptySourceReferenceIntent(scope: SourceReferenceScope): SourceReferenceIntent {
  return { schemaVersion: 1, ...scope, preparation: null, copyId: null, confirmation: null };
}

export function readSourceReferenceIntent(scope: SourceReferenceScope): SourceReferenceIntent {
  const value = sessionStorage.getItem(storageKey(scope));
  if (value === null) return emptySourceReferenceIntent(scope);
  const parsed = intentSchema.safeParse(JSON.parse(value));
  if (!parsed.success || parsed.data.actorId !== scope.actorId || parsed.data.tenantId !== scope.tenantId || parsed.data.versionId !== scope.versionId ||
    (parsed.data.confirmation && parsed.data.confirmation.copyId !== parsed.data.copyId)) {
    throw new Error("La reprise conservée est illisible. Aucune demande n’a été envoyée.");
  }
  return parsed.data;
}

export function saveSourceReferenceIntent(scope: SourceReferenceScope, intent: SourceReferenceIntent) {
  sessionStorage.setItem(storageKey(scope), JSON.stringify(intentSchema.parse(intent)));
}

export function sourceReferenceDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}
