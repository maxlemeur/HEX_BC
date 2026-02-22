import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { badRequest, mapSupabaseError } from "./errors";
import {
  buildEstimateDiff,
  type EstimateDiffEntry,
  type EstimateDiffFieldChange,
  type EstimateDiffResult,
  type EstimateVersionDetailsForDiff,
} from "./diff";

type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

type SnapshotFieldDefinition = {
  key: keyof EstimateItemRow;
  label: string;
  kind: EstimateDiffFieldChange["kind"];
};

type EstimateVersionChangelogCacheRow = {
  tenant_id: string;
  project_id: string;
  previous_version_id: string;
  current_version_id: string;
  previous_version_updated_at: string;
  current_version_updated_at: string;
  changelog_payload: unknown;
  delta_ht_cents: number;
  delta_ttc_cents: number;
  computed_at: string;
};

type EstimateVersionChangelogCacheInsert = {
  tenant_id: string;
  project_id: string;
  previous_version_id: string;
  current_version_id: string;
  previous_version_updated_at: string;
  current_version_updated_at: string;
  changelog_payload: EstimateVersionChangelog;
  delta_ht_cents: number;
  delta_ttc_cents: number;
  computed_at: string;
};

const ROOT_SECTION_KEY = "__root__";

const SECTION_SNAPSHOT_FIELDS: readonly SnapshotFieldDefinition[] = [
  {
    key: "title",
    label: "Titre",
    kind: "text",
  },
  {
    key: "description",
    label: "Description",
    kind: "text",
  },
];

const LINE_SNAPSHOT_FIELDS: readonly SnapshotFieldDefinition[] = [
  {
    key: "title",
    label: "Designation",
    kind: "text",
  },
  {
    key: "description",
    label: "Description",
    kind: "text",
  },
  {
    key: "quantity",
    label: "Quantite",
    kind: "number",
  },
  {
    key: "unit_price_ht_cents",
    label: "Prix unitaire HT",
    kind: "money",
  },
  {
    key: "line_total_ht_cents",
    label: "Total HT",
    kind: "money",
  },
  {
    key: "line_total_ttc_cents",
    label: "Total TTC",
    kind: "money",
  },
];

export type EstimateVersionChangelogField = {
  field: string;
  label: string;
  kind: EstimateDiffFieldChange["kind"];
  beforeValue: string | number | null;
  afterValue: string | number | null;
};

export type EstimateVersionChangelogChange = {
  key: string;
  changeType: EstimateDiffEntry["changeType"];
  entityType: EstimateDiffEntry["entityType"];
  designation: string;
  fields: EstimateVersionChangelogField[];
  deltaHtCents: number;
  deltaTtcCents: number;
};

export type EstimateVersionChangelogSection = {
  key: string;
  label: string;
  path: string[];
  changes: EstimateVersionChangelogChange[];
  deltaHtCents: number;
  deltaTtcCents: number;
};

export type EstimateVersionChangelogSummary = {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  totalChangeCount: number;
  deltaHtCents: number;
  deltaTtcCents: number;
};

export type EstimateVersionChangelog = {
  sections: EstimateVersionChangelogSection[];
  summary: EstimateVersionChangelogSummary;
};

export type EstimateVersionChangelogCacheStatus = "hit" | "miss" | "stale";

export type EstimateVersionChangelogResolution = {
  changelog: EstimateVersionChangelog;
  cacheStatus: EstimateVersionChangelogCacheStatus;
  computedAt: string;
};

function normalizeTextValue(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return Object.is(parsed, -0) ? 0 : parsed;
    }
  }

  return null;
}

function normalizeSnapshotValue(
  value: unknown,
  kind: EstimateDiffFieldChange["kind"]
): string | number | null {
  if (kind === "text" || kind === "reference") {
    return normalizeTextValue(value);
  }

  return normalizeNumberValue(value);
}

function sectionKeyFromPath(path: string[]) {
  if (path.length === 0) return ROOT_SECTION_KEY;
  return path.join(" > ");
}

function sectionLabelFromPath(path: string[]) {
  if (path.length === 0) return "Racine";
  return path.join(" / ");
}

function toLineTotals(item: EstimateItemRow | null) {
  if (!item || item.item_type !== "line") {
    return {
      totalHtCents: 0,
      totalTtcCents: 0,
    };
  }

  return {
    totalHtCents: item.line_total_ht_cents ?? 0,
    totalTtcCents: item.line_total_ttc_cents ?? 0,
  };
}

function toEntryDelta(entry: EstimateDiffEntry) {
  if (entry.changeType === "added") {
    const afterTotals = toLineTotals(entry.afterItem);
    return {
      deltaHtCents: afterTotals.totalHtCents,
      deltaTtcCents: afterTotals.totalTtcCents,
    };
  }

  if (entry.changeType === "removed") {
    const beforeTotals = toLineTotals(entry.beforeItem);
    return {
      deltaHtCents: -beforeTotals.totalHtCents,
      deltaTtcCents: -beforeTotals.totalTtcCents,
    };
  }

  const beforeTotals = toLineTotals(entry.beforeItem);
  const afterTotals = toLineTotals(entry.afterItem);
  return {
    deltaHtCents: afterTotals.totalHtCents - beforeTotals.totalHtCents,
    deltaTtcCents: afterTotals.totalTtcCents - beforeTotals.totalTtcCents,
  };
}

function fallbackSnapshotFields(entry: EstimateDiffEntry): EstimateVersionChangelogField[] {
  if (entry.changeType === "modified") {
    return entry.fieldChanges.map((fieldChange) => ({
      field: fieldChange.field,
      label: fieldChange.label,
      kind: fieldChange.kind,
      beforeValue: fieldChange.beforeValue,
      afterValue: fieldChange.afterValue,
    }));
  }

  const sourceItem = entry.changeType === "added" ? entry.afterItem : entry.beforeItem;
  if (!sourceItem) return [];

  const definitions =
    sourceItem.item_type === "section"
      ? SECTION_SNAPSHOT_FIELDS
      : LINE_SNAPSHOT_FIELDS;

  const beforeOrAfter = entry.changeType === "added" ? "after" : "before";
  const fields: EstimateVersionChangelogField[] = [];

  definitions.forEach((definition) => {
    const normalizedValue = normalizeSnapshotValue(
      sourceItem[definition.key],
      definition.kind
    );

    const defaultDesignation =
      definition.key === "title" && normalizedValue === null ? entry.title : null;
    const finalValue = normalizedValue ?? defaultDesignation;
    if (finalValue === null) return;

    fields.push({
      field: String(definition.key),
      label: definition.label,
      kind: definition.kind,
      beforeValue: beforeOrAfter === "before" ? finalValue : null,
      afterValue: beforeOrAfter === "after" ? finalValue : null,
    });
  });

  return fields;
}

function compareSections(
  left: { section: EstimateVersionChangelogSection; sortOrder: number },
  right: { section: EstimateVersionChangelogSection; sortOrder: number }
) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.section.label.localeCompare(right.section.label, "fr");
}

export function formatChangelogEntry(
  entry: EstimateDiffEntry
): EstimateVersionChangelogChange {
  const delta = toEntryDelta(entry);
  return {
    key: entry.key,
    changeType: entry.changeType,
    entityType: entry.entityType,
    designation: entry.title,
    fields: fallbackSnapshotFields(entry),
    deltaHtCents: delta.deltaHtCents,
    deltaTtcCents: delta.deltaTtcCents,
  };
}

export function computeSectionDeltas(changes: EstimateVersionChangelogChange[]) {
  return changes.reduce(
    (totals, change) => ({
      deltaHtCents: totals.deltaHtCents + change.deltaHtCents,
      deltaTtcCents: totals.deltaTtcCents + change.deltaTtcCents,
    }),
    {
      deltaHtCents: 0,
      deltaTtcCents: 0,
    }
  );
}

export function groupChangelogBySection(
  diffEntries: EstimateDiffEntry[]
): EstimateVersionChangelogSection[] {
  const groupedSections = new Map<
    string,
    {
      section: EstimateVersionChangelogSection;
      sortOrder: number;
    }
  >();

  diffEntries.forEach((entry) => {
    const key = sectionKeyFromPath(entry.sectionPath);
    const existing = groupedSections.get(key);

    if (!existing) {
      groupedSections.set(key, {
        section: {
          key,
          label: sectionLabelFromPath(entry.sectionPath),
          path: [...entry.sectionPath],
          changes: [],
          deltaHtCents: 0,
          deltaTtcCents: 0,
        },
        sortOrder: entry.sortOrder,
      });
    }

    const currentSection = groupedSections.get(key);
    if (!currentSection) return;

    currentSection.section.changes.push(formatChangelogEntry(entry));
    currentSection.sortOrder = Math.min(currentSection.sortOrder, entry.sortOrder);
  });

  return [...groupedSections.values()]
    .sort(compareSections)
    .map((item) => {
      const deltas = computeSectionDeltas(item.section.changes);
      return {
        ...item.section,
        deltaHtCents: deltas.deltaHtCents,
        deltaTtcCents: deltas.deltaTtcCents,
      };
    });
}

export function buildEstimateChangelogFromDiff(
  diff: EstimateDiffResult
): EstimateVersionChangelog {
  const sections = groupChangelogBySection(diff.entries);

  return {
    sections,
    summary: {
      addedCount: diff.summary.addedCount,
      removedCount: diff.summary.removedCount,
      modifiedCount: diff.summary.modifiedCount,
      totalChangeCount: diff.entries.length,
      deltaHtCents: diff.summary.deltaHtCents,
      deltaTtcCents: diff.summary.deltaTtcCents,
    },
  };
}

export function generateChangelog(input: {
  previous: EstimateVersionDetailsForDiff;
  current: EstimateVersionDetailsForDiff;
  diff?: EstimateDiffResult;
}): EstimateVersionChangelog {
  const diff = input.diff
    ? input.diff
    : buildEstimateDiff({
        previous: input.previous,
        current: input.current,
      });

  return buildEstimateChangelogFromDiff(diff);
}

export function buildEstimateChangelog(input: {
  previous: EstimateVersionDetailsForDiff;
  current: EstimateVersionDetailsForDiff;
  diff?: EstimateDiffResult;
}): EstimateVersionChangelog {
  return generateChangelog(input);
}

function isEstimateVersionChangelog(value: unknown): value is EstimateVersionChangelog {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EstimateVersionChangelog>;
  if (!Array.isArray(candidate.sections)) return false;
  if (!candidate.summary || typeof candidate.summary !== "object") return false;
  return true;
}

function toCacheRow(value: unknown): EstimateVersionChangelogCacheRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EstimateVersionChangelogCacheRow>;

  if (
    typeof row.tenant_id !== "string" ||
    typeof row.project_id !== "string" ||
    typeof row.previous_version_id !== "string" ||
    typeof row.current_version_id !== "string" ||
    typeof row.previous_version_updated_at !== "string" ||
    typeof row.current_version_updated_at !== "string" ||
    typeof row.delta_ht_cents !== "number" ||
    typeof row.delta_ttc_cents !== "number" ||
    typeof row.computed_at !== "string"
  ) {
    return null;
  }

  return row as EstimateVersionChangelogCacheRow;
}

function assertSameVersionScope(input: {
  previous: EstimateVersionDetailsForDiff;
  current: EstimateVersionDetailsForDiff;
}) {
  const sameTenant =
    input.previous.version.tenant_id === input.current.version.tenant_id;
  const sameProject =
    input.previous.version.project_id === input.current.version.project_id;

  if (!sameTenant || !sameProject) {
    throw badRequest(
      "Les versions comparees doivent appartenir au meme projet et au meme tenant."
    );
  }
}

export async function getOrBuildEstimateChangelog(input: {
  supabase: SupabaseClient<Database>;
  previous: EstimateVersionDetailsForDiff;
  current: EstimateVersionDetailsForDiff;
  diff?: EstimateDiffResult;
}): Promise<EstimateVersionChangelogResolution> {
  assertSameVersionScope({
    previous: input.previous,
    current: input.current,
  });

  const { data, error } = await input.supabase
    .from("estimate_version_changelogs")
    .select(
      "tenant_id, project_id, previous_version_id, current_version_id, previous_version_updated_at, current_version_updated_at, changelog_payload, delta_ht_cents, delta_ttc_cents, computed_at"
    )
    .eq("tenant_id", input.current.version.tenant_id)
    .eq("project_id", input.current.version.project_id)
    .eq("previous_version_id", input.previous.version.id)
    .eq("current_version_id", input.current.version.id)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le cache de changelog."
    );
  }

  const cachedRow = toCacheRow(data);
  const cachedPayload =
    cachedRow && isEstimateVersionChangelog(cachedRow.changelog_payload)
      ? cachedRow.changelog_payload
      : null;

  if (
    cachedRow &&
    cachedPayload &&
    cachedRow.previous_version_updated_at === input.previous.version.updated_at &&
    cachedRow.current_version_updated_at === input.current.version.updated_at
  ) {
    return {
      changelog: cachedPayload,
      cacheStatus: "hit",
      computedAt: cachedRow.computed_at,
    };
  }

  const changelog = generateChangelog({
    previous: input.previous,
    current: input.current,
    diff: input.diff,
  });
  const computedAt = new Date().toISOString();

  const upsertPayload: EstimateVersionChangelogCacheInsert = {
    tenant_id: input.current.version.tenant_id,
    project_id: input.current.version.project_id,
    previous_version_id: input.previous.version.id,
    current_version_id: input.current.version.id,
    previous_version_updated_at: input.previous.version.updated_at,
    current_version_updated_at: input.current.version.updated_at,
    changelog_payload: changelog,
    delta_ht_cents: changelog.summary.deltaHtCents,
    delta_ttc_cents: changelog.summary.deltaTtcCents,
    computed_at: computedAt,
  };

  const { error: upsertError } = await input.supabase
    .from("estimate_version_changelogs")
    .upsert(upsertPayload, {
      onConflict: "tenant_id,previous_version_id,current_version_id",
    });

  if (upsertError) {
    throw mapSupabaseError(
      upsertError,
      "Impossible de mettre a jour le cache de changelog."
    );
  }

  return {
    changelog,
    cacheStatus: cachedRow ? "stale" : "miss",
    computedAt,
  };
}
