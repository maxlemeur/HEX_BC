"use client";

import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { DndContext, closestCenter, type DndContextProps } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type VirtualItem } from "@tanstack/react-virtual";

import {
  type VirtualizedRow,
} from "@/components/estimates/hooks/useEstimateDndVirtualization";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type EstimateEditorBodyProps = {
  items: EstimateItem[];
  hasVisibleRows: boolean;
  isReadOnly: boolean;
  onAddRootSection: () => void;
  onResetQualityFilter: () => void;
  sensors: DndContextProps["sensors"];
  onDragEnd: DndContextProps["onDragEnd"];
  isVirtualized: boolean;
  virtualizedSortableIds: string[];
  virtualTotalSize: number;
  virtualItems: VirtualItem[];
  flattenedRows: VirtualizedRow[];
  measureElement: (element: HTMLDivElement | null) => void;
  virtualScrollRef?: React.RefObject<HTMLDivElement | null>;
  virtualBodyStyle?: CSSProperties;
  onBodyMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  spreadsheetRowCount: number;
  renderVirtualRow: (row: VirtualizedRow) => ReactNode;
  renderList: () => ReactNode;
};

export function EstimateEditorBody({
  items,
  hasVisibleRows,
  isReadOnly,
  onAddRootSection,
  onResetQualityFilter,
  sensors,
  onDragEnd,
  isVirtualized,
  virtualizedSortableIds,
  virtualTotalSize,
  virtualItems,
  flattenedRows,
  measureElement,
  virtualScrollRef,
  virtualBodyStyle,
  onBodyMouseDown,
  spreadsheetRowCount,
  renderVirtualRow,
  renderList,
}: EstimateEditorBodyProps) {
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <div
        ref={isVirtualized ? virtualScrollRef : undefined}
        className="estimate-table__body"
        style={virtualBodyStyle}
        onMouseDown={onBodyMouseDown}
        role="grid"
        aria-readonly={isReadOnly}
        aria-rowcount={spreadsheetRowCount}
        aria-label="Lignes de devis"
      >
        {items.length === 0 ? (
          <div className="estimate-empty">
            <p>Aucune ligne pour le moment.</p>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={onAddRootSection}
              disabled={isReadOnly}
            >
              Creer un chapitre
            </button>
          </div>
        ) : !hasVisibleRows ? (
          <div className="estimate-empty">
            <p>Aucune ligne ne correspond au filtre qualite actif.</p>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={onResetQualityFilter}
            >
              Afficher toutes les lignes
            </button>
          </div>
        ) : isVirtualized ? (
          <SortableContext
            items={virtualizedSortableIds}
            strategy={verticalListSortingStrategy}
          >
            <div
              style={{
                height: `${virtualTotalSize}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {virtualItems.map((virtualRow) => {
                const row = flattenedRows[virtualRow.index];
                if (!row) return null;
                return (
                  <div
                    key={row.key}
                    ref={measureElement}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {renderVirtualRow(row)}
                  </div>
                );
              })}
            </div>
          </SortableContext>
        ) : (
          renderList()
        )}
      </div>
    </DndContext>
  );
}
