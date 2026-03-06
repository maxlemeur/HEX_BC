import { Buffer } from "node:buffer";

import { z } from "zod";

export const affaireRegisterEntryKindSchema = z.enum([
  "assumption",
  "missing_piece",
]);
export const affaireRegisterEntrySeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);
export const affaireRegisterEntryStatusSchema = z.enum([
  "open",
  "validated",
  "rejected",
  "clarify_with_client",
]);
export const affaireRegisterEntryOriginKindSchema = z.enum([
  "ai",
  "manual",
  "system",
]);
export const affaireRegisterEventTypeSchema = z.enum([
  "created",
  "synced",
  "status_changed",
  "deactivated",
  "reactivated",
]);
export const affaireRegisterScopeTypeSchema = z.enum([
  "project",
  "lot",
  "line",
  "exception",
]);

export type AffaireRegisterEntryKind = z.infer<
  typeof affaireRegisterEntryKindSchema
>;
export type AffaireRegisterEntrySeverity = z.infer<
  typeof affaireRegisterEntrySeveritySchema
>;
export type AffaireRegisterEntryStatus = z.infer<
  typeof affaireRegisterEntryStatusSchema
>;
export type AffaireRegisterEntryOriginKind = z.infer<
  typeof affaireRegisterEntryOriginKindSchema
>;
export type AffaireRegisterEventType = z.infer<
  typeof affaireRegisterEventTypeSchema
>;
export type AffaireRegisterScopeType = z.infer<
  typeof affaireRegisterScopeTypeSchema
>;

export const AFFAIRE_REGISTER_KIND_LABELS: Record<
  AffaireRegisterEntryKind,
  string
> = {
  assumption: "Hypothese",
  missing_piece: "Piece manquante",
};

export const AFFAIRE_REGISTER_SEVERITY_LABELS: Record<
  AffaireRegisterEntrySeverity,
  string
> = {
  info: "Information",
  warning: "Attention",
  critical: "Critique",
};

export const AFFAIRE_REGISTER_STATUS_LABELS: Record<
  AffaireRegisterEntryStatus,
  string
> = {
  open: "Ouverte",
  validated: "Validee",
  rejected: "Rejetee",
  clarify_with_client: "A clarifier avec client",
};

export const AFFAIRE_REGISTER_ORIGIN_LABELS: Record<
  AffaireRegisterEntryOriginKind,
  string
> = {
  ai: "IA",
  manual: "Manuelle",
  system: "Systeme",
};
export const AFFAIRE_REGISTER_EVENT_LABELS: Record<
  AffaireRegisterEventType,
  string
> = {
  created: "Entree creee",
  synced: "Resynchronisee",
  status_changed: "Statut modifie",
  deactivated: "Entree archivee",
  reactivated: "Entree reactivee",
};

export const AFFAIRE_REGISTER_SCOPE_LABELS: Record<
  AffaireRegisterScopeType,
  string
> = {
  project: "Affaire",
  lot: "Lot",
  line: "Ligne",
  exception: "Exception",
};

export const AFFAIRE_REGISTER_STATUS_QUERY_PARAM = "registerStatus";
export const AFFAIRE_REGISTER_SEVERITY_QUERY_PARAM = "registerSeverity";
export const AFFAIRE_REGISTER_KIND_QUERY_PARAM = "registerKind";
export const AFFAIRE_REGISTER_CURSOR_QUERY_PARAM = "registerCursor";
export const AFFAIRE_REGISTER_FOCUS_QUERY_PARAM = "registerFocus";

const affaireRegisterCursorSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export type AffaireRegisterCursor = z.infer<typeof affaireRegisterCursorSchema>;

export type AffaireRegisterEntry = {
  id: string;
  kind: AffaireRegisterEntryKind;
  code: string | null;
  text: string;
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  originKind: AffaireRegisterEntryOriginKind;
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string;
  versionId: string | null;
  sourceDocumentId: string | null;
  sourceFileName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AffaireRegisterTimelineEvent = {
  id: string;
  entryId: string;
  eventType: AffaireRegisterEventType;
  entryKind: AffaireRegisterEntryKind;
  entryText: string;
  scopeLabel: string;
  actorUserId: string | null;
  actorUserName: string | null;
  comment: string | null;
  beforeStatus: AffaireRegisterEntryStatus | null;
  afterStatus: AffaireRegisterEntryStatus | null;
  createdAt: string;
};

export type AffaireRegisterPageResult = {
  items: AffaireRegisterEntry[];
  nextCursor: string | null;
  summary: AffaireRegisterSummary;
  timeline: AffaireRegisterTimelineEvent[];
  filters: {
    status: AffaireRegisterEntryStatus | null;
    severity: AffaireRegisterEntrySeverity | null;
    kind: AffaireRegisterEntryKind | null;
    cursor: string | null;
    focusEntryId: string | null;
  };
};

export type AffaireRegisterScopeOption = {
  id: string;
  label: string;
};

export type AffaireRegisterScopeOptions = {
  lots: AffaireRegisterScopeOption[];
  lines: AffaireRegisterScopeOption[];
};

export type AffaireRegisterSummary = {
  openQuestionsCount: number;
  criticalOpenCount: number;
  nonCriticalOpenCount: number;
  clarifyWithClientCount: number;
};

export function parseAffaireRegisterStatusSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = affaireRegisterEntryStatusSchema.safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function parseAffaireRegisterSeveritySearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = affaireRegisterEntrySeveritySchema.safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function parseAffaireRegisterKindSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = affaireRegisterEntryKindSchema.safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function parseAffaireRegisterCursorSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    return null;
  }

  try {
    const decoded = Buffer.from(normalized, "base64url").toString("utf8");
    const parsed = affaireRegisterCursorSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseAffaireRegisterFocusSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = z.string().uuid().safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function encodeAffaireRegisterCursor(cursor: AffaireRegisterCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function normalizeAffaireRegisterText(
  value: string,
  maxLength = 320
) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength).trim();
}

export function isAffaireRegisterEntryResolved(status: AffaireRegisterEntryStatus) {
  return status === "validated" || status === "rejected";
}

export function buildAffaireRegisterSearchHref(input: {
  pathname: string;
  searchParams: URLSearchParams;
  status?: AffaireRegisterEntryStatus | null;
  severity?: AffaireRegisterEntrySeverity | null;
  kind?: AffaireRegisterEntryKind | null;
  cursor?: string | null;
  focusEntryId?: string | null;
}) {
  const params = new URLSearchParams(input.searchParams.toString());

  if (input.status) {
    params.set(AFFAIRE_REGISTER_STATUS_QUERY_PARAM, input.status);
  } else {
    params.delete(AFFAIRE_REGISTER_STATUS_QUERY_PARAM);
  }

  if (input.severity) {
    params.set(AFFAIRE_REGISTER_SEVERITY_QUERY_PARAM, input.severity);
  } else {
    params.delete(AFFAIRE_REGISTER_SEVERITY_QUERY_PARAM);
  }

  if (input.kind) {
    params.set(AFFAIRE_REGISTER_KIND_QUERY_PARAM, input.kind);
  } else {
    params.delete(AFFAIRE_REGISTER_KIND_QUERY_PARAM);
  }

  if (input.cursor) {
    params.set(AFFAIRE_REGISTER_CURSOR_QUERY_PARAM, input.cursor);
  } else {
    params.delete(AFFAIRE_REGISTER_CURSOR_QUERY_PARAM);
  }

  if (input.focusEntryId) {
    params.set(AFFAIRE_REGISTER_FOCUS_QUERY_PARAM, input.focusEntryId);
  } else {
    params.delete(AFFAIRE_REGISTER_FOCUS_QUERY_PARAM);
  }

  const query = params.toString();
  return query ? `${input.pathname}?${query}` : input.pathname;
}

export function buildAffaireRegisterHubHref(input: {
  projectId: string;
  status?: AffaireRegisterEntryStatus | null;
  severity?: AffaireRegisterEntrySeverity | null;
  kind?: AffaireRegisterEntryKind | null;
  focusEntryId?: string | null;
}) {
  return buildAffaireRegisterSearchHref({
    pathname: `/dashboard/affaires/${input.projectId}`,
    searchParams: new URLSearchParams(),
    status: input.status ?? null,
    severity: input.severity ?? null,
    kind: input.kind ?? null,
    cursor: null,
    focusEntryId: input.focusEntryId ?? null,
  });
}
