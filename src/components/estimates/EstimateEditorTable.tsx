"use client";

import { Fragment, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { formatEUR, parseEuroToCents } from "@/lib/money";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

type ItemPatch = Partial<
  Pick<
    EstimateItem,
    | "title"
    | "description"
    | "quantity"
    | "unit_price_ht_cents"
    | "tax_rate_bp"
    | "k_fo"
    | "h_mo"
    | "k_mo"
    | "pu_ht_cents"
    | "labor_role_id"
    | "category_id"
  >
>;

type EstimateEditorTableProps = {
  items: EstimateItem[];
  categories: EstimateCategory[];
  laborRoles: LaborRole[];
  actionError: string | null;
  isReadOnly: boolean;
  onAddSection: (parentId: string | null) => void;
  onAddLine: (parentId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
  onEnsureCategory: (name: string) => Promise<EstimateCategory | null>;
};

const ROOT_KEY = "root";
const DEFAULT_UNITS = ["u", "ml", "m2", "ens"];

function getParentKey(id: string | null) {
  return id ?? ROOT_KEY;
}

function formatCentsInput(cents: number | null) {
  if (!Number.isFinite(cents ?? NaN)) return "";
  return ((cents ?? 0) / 100).toFixed(2);
}

function parseNumberInput(value: string) {
  const normalized = value.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

type SortableReturn = ReturnType<typeof useSortable>;
type DragHandleProps = {
  listeners?: SortableReturn["listeners"];
  attributes?: SortableReturn["attributes"];
  disabled?: boolean;
};

function DragHandle({ listeners, attributes, disabled }: DragHandleProps) {
  return (
    <button
      type="button"
      className="estimate-drag-handle"
      {...attributes}
      {...listeners}
      disabled={disabled}
      aria-label="Glisser pour reordonner"
    >
      <svg viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5" cy="4" r="1.2" />
        <circle cx="11" cy="4" r="1.2" />
        <circle cx="5" cy="8" r="1.2" />
        <circle cx="11" cy="8" r="1.2" />
        <circle cx="5" cy="12" r="1.2" />
        <circle cx="11" cy="12" r="1.2" />
      </svg>
    </button>
  );
}

function SortableRow({
  item,
  depth,
  unitValue,
  categoryValue,
  laborRoles,
  onAddSection,
  onAddLine,
  onDeleteItem,
  onPatchItem,
  onUnitChange,
  onUnitCommit,
  onCategoryChange,
  onCategoryCommit,
  isReadOnly,
}: {
  item: EstimateItem;
  depth: number;
  unitValue: string;
  categoryValue: string;
  laborRoles: LaborRole[];
  onAddSection: (parentId: string | null) => void;
  onAddLine: (parentId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
  onUnitChange: (itemId: string, value: string) => void;
  onUnitCommit: (itemId: string) => void;
  onCategoryChange: (itemId: string, value: string) => void;
  onCategoryCommit: (itemId: string) => void;
  isReadOnly: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { parentId: item.parent_id ?? null },
    disabled: isReadOnly,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
  };

  const indentStyle = {
    paddingLeft: `${depth * 20}px`,
  };

  if (item.item_type === "section") {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="estimate-row estimate-row--section"
      >
        <div className="estimate-cell estimate-cell--designation" style={indentStyle}>
          <DragHandle
            listeners={listeners}
            attributes={attributes}
            disabled={isReadOnly}
          />
          <input
            className="estimate-input estimate-input--title"
            value={item.title}
            disabled={isReadOnly}
            onChange={(event) =>
              onPatchItem(item.id, { title: event.target.value }, { persist: false })
            }
            onBlur={(event) => {
              const nextTitle = event.target.value.trim() || "Sans titre";
              onPatchItem(item.id, { title: nextTitle }, { persist: true });
            }}
          />
        </div>
        <div className="estimate-cell estimate-cell--section-actions">
          <div className="estimate-row-actions">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => onAddLine(item.id)}
              disabled={isReadOnly}
            >
              + Ligne
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => onAddSection(item.id)}
              disabled={isReadOnly}
            >
              + Sous-chapitre
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => onDeleteItem(item.id)}
              disabled={isReadOnly}
            >
              Supprimer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const lineTotal = item.line_total_ht_cents ?? 0;
  const kFoValue = item.k_fo ?? 1;
  const hMoValue = item.h_mo ?? 0;
  const kMoValue = item.k_mo ?? 1;
  const puValue = formatCentsInput(item.pu_ht_cents);

  return (
    <div ref={setNodeRef} style={style} className="estimate-row">
      <div className="estimate-cell estimate-cell--designation" style={indentStyle}>
        <DragHandle
          listeners={listeners}
          attributes={attributes}
          disabled={isReadOnly}
        />
        <input
          className="estimate-input estimate-input--title"
          value={item.title}
          disabled={isReadOnly}
          onChange={(event) =>
            onPatchItem(item.id, { title: event.target.value }, { persist: false })
          }
          onBlur={(event) => {
            const nextTitle = event.target.value.trim() || "Nouvelle ligne";
            onPatchItem(item.id, { title: nextTitle }, { persist: true });
          }}
        />
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          type="number"
          step="0.001"
          min={0}
          value={item.quantity ?? 0}
          disabled={isReadOnly}
          onChange={(event) =>
            onPatchItem(
              item.id,
              { quantity: parseNumberInput(event.target.value) },
              { persist: false }
            )
          }
          onBlur={(event) =>
            onPatchItem(
              item.id,
              { quantity: parseNumberInput(event.target.value) },
              { persist: true }
            )
          }
        />
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          list="estimate-unit-options"
          value={unitValue}
          onChange={(event) => onUnitChange(item.id, event.target.value)}
          onBlur={() => onUnitCommit(item.id)}
          placeholder="u"
          disabled={isReadOnly}
        />
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          type="number"
          step="0.01"
          min={0}
          value={formatCentsInput(item.unit_price_ht_cents)}
          disabled={isReadOnly}
          onChange={(event) =>
            onPatchItem(
              item.id,
              { unit_price_ht_cents: parseEuroToCents(event.target.value) ?? 0 },
              { persist: false }
            )
          }
          onBlur={(event) =>
            onPatchItem(
              item.id,
              { unit_price_ht_cents: parseEuroToCents(event.target.value) ?? 0 },
              { persist: true }
            )
          }
        />
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          list="estimate-fo-type-options"
          value={categoryValue}
          onChange={(event) => onCategoryChange(item.id, event.target.value)}
          onBlur={() => onCategoryCommit(item.id)}
          placeholder="Materiaux"
          disabled={isReadOnly}
        />
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          type="number"
          step="0.01"
          min={0}
          value={kFoValue}
          onChange={(event) =>
            onPatchItem(
              item.id,
              { k_fo: parseNumberInput(event.target.value) },
              { persist: false }
            )
          }
          onBlur={(event) =>
            onPatchItem(
              item.id,
              { k_fo: parseNumberInput(event.target.value) },
              { persist: true }
            )
          }
          placeholder="1.00"
          disabled={isReadOnly}
        />
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          type="number"
          step="0.1"
          min={0}
          value={hMoValue}
          onChange={(event) =>
            onPatchItem(
              item.id,
              { h_mo: parseNumberInput(event.target.value) },
              { persist: false }
            )
          }
          onBlur={(event) =>
            onPatchItem(
              item.id,
              { h_mo: parseNumberInput(event.target.value) },
              { persist: true }
            )
          }
          placeholder="0.0"
          disabled={isReadOnly}
        />
      </div>
      <div className="estimate-cell">
        <select
          className="estimate-input estimate-select"
          value={item.labor_role_id ?? ""}
          onChange={(event) =>
            onPatchItem(
              item.id,
              { labor_role_id: event.target.value || null },
              { persist: true }
            )
          }
          disabled={isReadOnly}
        >
          <option value="">-</option>
          {laborRoles.map((role) => (
            <option key={role.id} value={role.id} disabled={!role.is_active}>
              {role.name}
              {!role.is_active ? " (inactif)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          type="number"
          step="0.01"
          min={0}
          value={kMoValue}
          onChange={(event) =>
            onPatchItem(
              item.id,
              { k_mo: parseNumberInput(event.target.value) },
              { persist: false }
            )
          }
          onBlur={(event) =>
            onPatchItem(
              item.id,
              { k_mo: parseNumberInput(event.target.value) },
              { persist: true }
            )
          }
          placeholder="1.00"
          disabled={isReadOnly}
        />
      </div>
      <div className="estimate-cell">
        <input
          className="estimate-input"
          type="number"
          step="0.01"
          min={0}
          value={puValue}
          placeholder="0.00"
          readOnly
          disabled={isReadOnly}
        />
      </div>
      <div className="estimate-cell estimate-cell--total">
        <span>{formatEUR(lineTotal)}</span>
      </div>
      <div className="estimate-cell estimate-cell--actions">
        <button
          className="btn btn-danger btn-sm"
          type="button"
          onClick={() => onDeleteItem(item.id)}
          disabled={isReadOnly}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

export function EstimateEditorTable({
  items,
  categories,
  laborRoles,
  actionError,
  isReadOnly,
  onAddSection,
  onAddLine,
  onDeleteItem,
  onPatchItem,
  onReorder,
  onEnsureCategory,
}: EstimateEditorTableProps) {
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const itemsByParent = useMemo(() => {
    const map = new Map<string, EstimateItem[]>();
    items.forEach((item) => {
      const key = getParentKey(item.parent_id);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });
    map.forEach((list) => list.sort((a, b) => a.position - b.position));
    return map;
  }, [items]);

  const depthMap = useMemo(() => {
    const depth = new Map<string, number>();
    function walk(parentId: string | null, level: number) {
      const list = itemsByParent.get(getParentKey(parentId)) ?? [];
      list.forEach((item) => {
        depth.set(item.id, level);
        if (item.item_type === "section") {
          walk(item.id, level + 1);
        }
      });
    }
    walk(null, 0);
    return depth;
  }, [itemsByParent]);

  const mergedUnitDrafts = useMemo(() => {
    const next = { ...unitDrafts };
    items.forEach((item) => {
      if (item.item_type !== "line") return;
      if (next[item.id] === undefined) {
        next[item.id] = item.description ?? "";
      }
    });
    return next;
  }, [items, unitDrafts]);

  const mergedCategoryDrafts = useMemo(() => {
    const next = { ...categoryDrafts };
    items.forEach((item) => {
      if (item.item_type !== "line") return;
      if (next[item.id] !== undefined) return;
      const category = categories.find((cat) => cat.id === item.category_id);
      next[item.id] = category?.name ?? "";
    });
    return next;
  }, [items, categories, categoryDrafts]);

  async function handleCategoryCommit(itemId: string) {
    if (isReadOnly) return;
    const value = (mergedCategoryDrafts[itemId] ?? "").trim();
    if (!value) {
      onPatchItem(itemId, { category_id: null }, { persist: true });
      return;
    }
    const existing = categories.find(
      (category) => category.name.toLowerCase() === value.toLowerCase()
    );
    if (existing) {
      onPatchItem(itemId, { category_id: existing.id }, { persist: true });
      return;
    }
    const created = await onEnsureCategory(value);
    if (created) {
      onPatchItem(itemId, { category_id: created.id }, { persist: true });
    }
  }

  function handleUnitCommit(itemId: string) {
    if (isReadOnly) return;
    const value = (mergedUnitDrafts[itemId] ?? "").trim();
    onPatchItem(itemId, { description: value || null }, { persist: true });
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isReadOnly) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeParent = active.data.current?.parentId ?? null;
    const overParent = over.data.current?.parentId ?? null;
    if (activeParent !== overParent) return;

    const siblings = itemsByParent.get(getParentKey(activeParent)) ?? [];
    const oldIndex = siblings.findIndex((item) => item.id === active.id);
    const newIndex = siblings.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const ordered = arrayMove(siblings, oldIndex, newIndex).map(
      (item) => item.id
    );
    onReorder(activeParent, ordered);
  }

  function renderList(parentId: string | null) {
    const list = itemsByParent.get(getParentKey(parentId)) ?? [];
    if (list.length === 0) return null;

    return (
      <div className="estimate-group">
        <SortableContext
          items={list.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {list.map((item) => (
            <Fragment key={item.id}>
              <SortableRow
                item={item}
                depth={depthMap.get(item.id) ?? 0}
                unitValue={mergedUnitDrafts[item.id] ?? ""}
                categoryValue={mergedCategoryDrafts[item.id] ?? ""}
                laborRoles={laborRoles}
                onAddSection={onAddSection}
                onAddLine={onAddLine}
                onDeleteItem={onDeleteItem}
                onPatchItem={onPatchItem}
                onUnitChange={(id, value) =>
                  setUnitDrafts((prev) => ({ ...prev, [id]: value }))
                }
                onUnitCommit={handleUnitCommit}
                onCategoryChange={(id, value) =>
                  setCategoryDrafts((prev) => ({ ...prev, [id]: value }))
                }
                onCategoryCommit={handleCategoryCommit}
                isReadOnly={isReadOnly}
              />
              {item.item_type === "section" ? renderList(item.id) : null}
            </Fragment>
          ))}
        </SortableContext>
      </div>
    );
  }

  return (
    <div className="dashboard-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            Editeur du devis
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Organisez chapitres, sous-chapitres et lignes FO/MO.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => onAddSection(null)}
            disabled={isReadOnly}
          >
            + Chapitre
          </button>
        </div>
      </div>

      {actionError && (
        <div className="alert alert-error mt-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {actionError}
        </div>
      )}

      <div className="estimate-table mt-6">
        <div className="estimate-table__head">
          <div>Designation</div>
          <div>Qte</div>
          <div>U</div>
          <div>PR. FO</div>
          <div>Type FO</div>
          <div>K FO</div>
          <div>h MO</div>
          <div>Type MO</div>
          <div>K MO</div>
          <div>P.U.</div>
          <div>Prix total</div>
          <div></div>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="estimate-table__body">
            {items.length === 0 ? (
              <div className="estimate-empty">
                <p>Aucune ligne pour le moment.</p>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => onAddSection(null)}
                  disabled={isReadOnly}
                >
                  Creer un chapitre
                </button>
              </div>
            ) : (
              renderList(null)
            )}
          </div>
        </DndContext>
      </div>

      <datalist id="estimate-unit-options">
        {DEFAULT_UNITS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

      <datalist id="estimate-fo-type-options">
        {categories.map((category) => (
          <option key={category.id} value={category.name} />
        ))}
      </datalist>
    </div>
  );
}
