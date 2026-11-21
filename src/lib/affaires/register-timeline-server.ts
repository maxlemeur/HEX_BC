import type { AffaireAccessProject } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import type { Json } from "@/types/database";
import type { AuthenticatedRegisterContext } from "@/lib/affaires/register-store-server";

import {
  affaireRegisterEventTypeSchema,
  affaireRegisterEntryKindSchema,
  affaireRegisterEntryStatusSchema,
  type AffaireRegisterEventType,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterTimelineEvent,
} from "./register";
import { isRecord, toStringOrNull } from "@/lib/value-guards";
import { resolveEmbeddedOne } from "@/lib/supabase/embedded";

type AffaireRegisterEventRow = {
  id: string;
  entry_id: string;
  actor_user_id: string | null;
  event_type: AffaireRegisterEventType;
  reason: string | null;
  before_payload: Json | null;
  after_payload: Json | null;
  created_at: string;
  actor_profile: { full_name: string | null } | null;
  entry: {
    kind: AffaireRegisterEntryKind;
    text: string;
    scope_label: string;
    project_id: string;
    version_id: string | null;
  } | null;
};

const EVENT_SELECT = [
  "id",
  "entry_id",
  "actor_user_id",
  "event_type",
  "reason",
  "before_payload",
  "after_payload",
  "created_at",
  "actor_profile:actor_user_id(full_name)",
  "entry:affaire_register_entries!inner(project_id, version_id, kind, text, scope_label)",
].join(", ");

function extractRegisterEventStatus(
  payload: Json | null | undefined
): AffaireRegisterEntryStatus | null {
  if (!isRecord(payload)) {
    return null;
  }

  const parsed = affaireRegisterEntryStatusSchema.safeParse(payload.status);
  return parsed.success ? parsed.data : null;
}

function extractRegisterEventComment(payload: Json | null | undefined) {
  if (!isRecord(payload)) {
    return null;
  }

  return toStringOrNull(payload.comment);
}

function normalizeRegisterEventReason(reason: string | null) {
  if (!reason) {
    return null;
  }

  const normalized = reason.trim();

  if (!normalized) {
    return null;
  }

  if (/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeAffaireRegisterEventRow(row: unknown): AffaireRegisterEventRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const eventType = affaireRegisterEventTypeSchema.safeParse(row.event_type);
  const entry = resolveEmbeddedOne(
    row.entry as
      | {
          kind: AffaireRegisterEntryKind;
          text: string;
          scope_label: string;
          project_id: string;
          version_id: string | null;
        }
      | Array<{
          kind: AffaireRegisterEntryKind;
          text: string;
          scope_label: string;
          project_id: string;
          version_id: string | null;
        }>
      | null
  );
  const actorProfile = resolveEmbeddedOne(
    row.actor_profile as
      | { full_name: string | null }
      | Array<{ full_name: string | null }>
      | null
  );

  const kind = affaireRegisterEntryKindSchema.safeParse(entry?.kind);

  if (
    !eventType.success ||
    !entry ||
    !kind.success ||
    typeof row.id !== "string" ||
    typeof row.entry_id !== "string" ||
    typeof entry.text !== "string" ||
    typeof entry.scope_label !== "string" ||
    typeof entry.project_id !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    entry_id: row.entry_id,
    actor_user_id: toStringOrNull(row.actor_user_id),
    event_type: eventType.data,
    reason: toStringOrNull(row.reason),
    before_payload: row.before_payload as Json | null,
    after_payload: row.after_payload as Json | null,
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    actor_profile: actorProfile,
    entry: {
      kind: kind.data,
      text: entry.text.trim(),
      scope_label: entry.scope_label.trim(),
      project_id: entry.project_id,
      version_id: toStringOrNull(entry.version_id),
    },
  };
}

function toAffaireRegisterTimelineEvent(
  row: AffaireRegisterEventRow
): AffaireRegisterTimelineEvent {
  return {
    id: row.id,
    entryId: row.entry_id,
    eventType: row.event_type,
    entryKind: row.entry?.kind ?? "assumption",
    entryText: row.entry?.text ?? "",
    scopeLabel: row.entry?.scope_label ?? "Affaire",
    actorUserId: row.actor_user_id,
    actorUserName: row.actor_profile?.full_name?.trim() || null,
    comment:
      extractRegisterEventComment(row.after_payload) ??
      extractRegisterEventComment(row.before_payload) ??
      normalizeRegisterEventReason(row.reason),
    beforeStatus: extractRegisterEventStatus(row.before_payload),
    afterStatus: extractRegisterEventStatus(row.after_payload),
    createdAt: row.created_at,
  };
}

export async function fetchAffaireRegisterTimelineWithContext(input: {
  context: AuthenticatedRegisterContext;
  project: AffaireAccessProject;
  versionId?: string | null;
  size?: number;
}): Promise<AffaireRegisterTimelineEvent[]> {
  const { context, project } = input;
  let query = context.supabase
    .from("affaire_register_events")
    .select(EVENT_SELECT as never)
    .eq("project_id", project.id as never);

  if (input.versionId) {
    query = query.or(`version_id.is.null,version_id.eq.${input.versionId}`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(input.size ?? 12, 25)));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'historique du registre.");
  }

  return ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEventRow(row))
    .filter((row): row is AffaireRegisterEventRow => row !== null)
    .map(toAffaireRegisterTimelineEvent);
}
