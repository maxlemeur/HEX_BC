import { readAllRows } from "@/lib/supabase/read-all";

import { requireAffaireAccess, type AffaireAccessProject } from "@/lib/affaires/access-server";
import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";
import {
  badRequest,
  mapSupabaseError,
  notFound,
} from "@/lib/http/api-response";
import { type AuthenticatedRegisterContext, REGISTER_ACCESS } from "@/lib/affaires/register-store-server";

import {
  normalizeAffaireRegisterText,
  type AffaireRegisterScopeOption,
  type AffaireRegisterScopeOptions,
  type AffaireRegisterScopeType,
} from "./register";
import { isRecord, toStringOrNull } from "@/lib/value-guards";

type EstimateItemScopeRow = {
  id: string;
  title: string | null;
  item_type: "section" | "line" | string;
  parent_id: string | null;
  position: number;
};

function normalizeEstimateItemScopeRow(row: unknown): EstimateItemScopeRow | null {
  if (!isRecord(row)) {
    return null;
  }

  if (typeof row.id !== "string" || typeof row.position !== "number") {
    return null;
  }

  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : null,
    item_type: typeof row.item_type === "string" ? row.item_type : "line",
    parent_id: toStringOrNull(row.parent_id),
    position: row.position,
  };
}

export async function fetchAffaireRegisterScopeOptions(input: {
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterScopeOptions> {
  const { context } = await requireAffaireAccess(input.projectId, "read", REGISTER_ACCESS);

  if (!input.versionId) {
    return {
      lots: [],
      lines: [],
    };
  }

  const versionId = input.versionId;
  const { data, error } = await readAllRows(() => context.supabase
    .from("estimate_items")
    .select("id, title, item_type, parent_id, position", { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .eq("version_id", versionId)
    .in("item_type", ["section", "line"])
    .order("position", { ascending: true })
    .order("id", { ascending: true }), { concurrency: 4 });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les scopes du registre.");
  }

  const rows = ((data ?? []) as unknown[])
    .map((row) => normalizeEstimateItemScopeRow(row))
    .filter((row): row is EstimateItemScopeRow => row !== null);
  const numberingById = computeEstimateItemNumbering(
    rows
      .filter((row): row is EstimateItemScopeRow & { item_type: "section" | "line" } =>
        row.item_type === "section" || row.item_type === "line"
      )
      .map((row) => ({
        id: row.id,
        parent_id: row.parent_id,
        position: row.position,
        item_type: row.item_type,
      }))
  );
  const toOption = (row: EstimateItemScopeRow): AffaireRegisterScopeOption => {
    const title = row.title?.trim() || `${row.item_type === "section" ? "Lot" : "Ligne"} ${row.id.slice(0, 8)}`;
    const prefix = numberingById[row.id];
    return {
      id: row.id,
      label: prefix ? `${prefix} - ${title}` : title,
    };
  };

  return {
    lots: rows.filter((row) => row.item_type === "section").map(toOption),
    lines: rows.filter((row) => row.item_type === "line").map(toOption),
  };
}

export async function resolveScopeForEntry(input: {
  context: AuthenticatedRegisterContext;
  project: AffaireAccessProject;
  versionId: string | null;
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string | null;
}) {
  if (input.scopeType === "project") {
    return {
      versionId: null,
      scopeId: null,
      scopeRef: null,
      scopeLabel: input.project.name,
    };
  }

  if (input.scopeType === "exception") {
    if (!input.versionId) {
      throw badRequest("Une version est requise pour lier une exception.");
    }

    return {
      versionId: input.versionId,
      scopeId: null,
      scopeRef: normalizeAffaireRegisterText(input.scopeRef ?? "", 120),
      scopeLabel: normalizeAffaireRegisterText(input.scopeLabel ?? "", 180),
    };
  }

  if (!input.versionId || !input.scopeId) {
    throw badRequest("Le périmètre sélectionné est incomplet.");
  }

  const { data, error } = await input.context.supabase
    .from("estimate_items")
    .select("id, title, item_type, parent_id, position")
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("id", input.scopeId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le scope du registre.");
  }

  const item = normalizeEstimateItemScopeRow(data);
  if (!item) {
    throw notFound("Scope du registre introuvable.");
  }

  const expectedItemType = input.scopeType === "lot" ? "section" : "line";
  if (item.item_type !== expectedItemType) {
    throw badRequest("Le périmètre sélectionné ne correspond pas au type attendu.");
  }

  const { lots, lines } = await fetchAffaireRegisterScopeOptions({
    projectId: input.project.id,
    versionId: input.versionId,
  });
  const scopeLabel =
    (input.scopeType === "lot" ? lots : lines).find((option) => option.id === item.id)?.label ??
    item.title?.trim() ??
    item.id;

  return {
    versionId: input.versionId,
    scopeId: item.id,
    scopeRef: null,
    scopeLabel,
  };
}
