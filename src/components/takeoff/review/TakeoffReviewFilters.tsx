"use client";

import { useId } from "react";
import { ArrowDownIcon, ArrowUpIcon, SlidersHorizontalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

// ---------------------------------------------------------------------------
// Filter model
// ---------------------------------------------------------------------------

export type InclusionFilter = "all" | "included" | "excluded";
export type VerificationFilter = "all" | "verified" | "unverified";
export type AnomalyFilter = "all" | "with_anomalies" | "without_anomalies";
export type ConfidenceFilter = "all" | "high" | "medium" | "low" | "missing";
export type SortField = "designation" | "quantity" | "category" | "confidence";
export type SortDirection = "asc" | "desc";

export type ReviewTableFilters = {
  search: string;
  inclusion: InclusionFilter;
  anomaly: AnomalyFilter;
  verification: VerificationFilter;
  confidence: ConfidenceFilter;
  category: string;
  page: string;
  table: string;
};

export const DEFAULT_REVIEW_TABLE_FILTERS: ReviewTableFilters = {
  search: "",
  inclusion: "all",
  anomaly: "all",
  verification: "all",
  confidence: "all",
  category: "all",
  page: "all",
  table: "all",
};

const SECONDARY_FILTER_KEYS = ["verification", "confidence", "category", "page", "table"] as const;

export const SORT_FIELD_LABELS: Record<SortField, string> = {
  designation: "Désignation",
  quantity: "Quantité",
  category: "Catégorie",
  confidence: "Confiance",
};

export function countActiveSecondaryFilters(filters: ReviewTableFilters): number {
  return SECONDARY_FILTER_KEYS.filter((key) => filters[key] !== "all").length;
}

// ---------------------------------------------------------------------------
// Filter bar: primary filters inline, the rest behind "Plus de filtres"
// ---------------------------------------------------------------------------

type TakeoffReviewFiltersProps = {
  filters: ReviewTableFilters;
  onFiltersChange: (patch: Partial<ReviewTableFilters>) => void;
  categories: string[];
  pages: number[];
  tableIndices: number[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (field: SortField) => void;
  onToggleSortDirection: () => void;
  filteredCount: number;
  totalCount: number;
};

export function TakeoffReviewFilters({
  filters,
  onFiltersChange,
  categories,
  pages,
  tableIndices,
  sortField,
  sortDirection,
  onSortFieldChange,
  onToggleSortDirection,
  filteredCount,
  totalCount,
}: TakeoffReviewFiltersProps) {
  const idPrefix = useId();
  const activeSecondaryCount = countActiveSecondaryFilters(filters);
  const sortDirectionLabel = sortDirection === "asc" ? "Croissant" : "Décroissant";

  return (
    <div
      role="search"
      aria-label="Filtres des items extraits"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="w-full min-w-0 sm:w-64">
        <FieldLabel htmlFor={`${idPrefix}-search`} className="sr-only">
          Rechercher par désignation
        </FieldLabel>
        <Input
          id={`${idPrefix}-search`}
          type="search"
          size="sm"
          placeholder="Rechercher par désignation…"
          value={filters.search}
          onChange={(event) => onFiltersChange({ search: event.target.value })}
        />
      </div>

      <NativeSelect
        size="sm"
        wrapperClassName="w-auto"
        aria-label="Inclusion"
        value={filters.inclusion}
        onChange={(event) => onFiltersChange({ inclusion: event.target.value as InclusionFilter })}
      >
        <option value="all">Toutes les lignes</option>
        <option value="included">Incluses</option>
        <option value="excluded">Exclues</option>
      </NativeSelect>

      <NativeSelect
        size="sm"
        wrapperClassName="w-auto"
        aria-label="Anomalies"
        value={filters.anomaly}
        onChange={(event) => onFiltersChange({ anomaly: event.target.value as AnomalyFilter })}
      >
        <option value="all">Avec ou sans anomalie</option>
        <option value="with_anomalies">Avec anomalies</option>
        <option value="without_anomalies">Sans anomalies</option>
      </NativeSelect>

      <div className="flex items-center gap-1">
        <NativeSelect
          size="sm"
          wrapperClassName="w-auto"
          aria-label="Trier par"
          value={sortField}
          onChange={(event) => onSortFieldChange(event.target.value as SortField)}
        >
          {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((field) => (
            <option key={field} value={field}>
              Tri : {SORT_FIELD_LABELS[field]}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Ordre de tri : ${sortDirectionLabel}`}
          onClick={onToggleSortDirection}
        >
          {sortDirection === "asc" ? (
            <ArrowUpIcon aria-hidden="true" />
          ) : (
            <ArrowDownIcon aria-hidden="true" />
          )}
        </Button>
      </div>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              leftIcon={<SlidersHorizontalIcon aria-hidden="true" />}
            />
          }
        >
          Plus de filtres
          {activeSecondaryCount > 0 ? (
            <Badge variant="brand" size="sm">
              {activeSecondaryCount}
              <span className="sr-only"> actif{activeSecondaryCount > 1 ? "s" : ""}</span>
            </Badge>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-4">
          <PopoverHeader>
            <PopoverTitle>Plus de filtres</PopoverTitle>
            <PopoverDescription>Affinez la liste sans quitter la revue.</PopoverDescription>
          </PopoverHeader>

          <SecondarySelect
            id={`${idPrefix}-verification`}
            label="Vérification"
            value={filters.verification}
            onChange={(value) => onFiltersChange({ verification: value as VerificationFilter })}
          >
            <option value="all">Toutes</option>
            <option value="verified">Vérifiés</option>
            <option value="unverified">Non vérifiés</option>
          </SecondarySelect>

          <SecondarySelect
            id={`${idPrefix}-confidence`}
            label="Confiance"
            value={filters.confidence}
            onChange={(value) => onFiltersChange({ confidence: value as ConfidenceFilter })}
          >
            <option value="all">Toute confiance</option>
            <option value="high">Fiable (&gt; 80 %)</option>
            <option value="medium">À vérifier (50-80 %)</option>
            <option value="low">Problématique (&lt; 50 %)</option>
            <option value="missing">Non évaluée</option>
          </SecondarySelect>

          {categories.length > 0 ? (
            <SecondarySelect
              id={`${idPrefix}-category`}
              label="Catégorie"
              value={filters.category}
              onChange={(value) => onFiltersChange({ category: value })}
            >
              <option value="all">Toutes catégories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </SecondarySelect>
          ) : null}

          {pages.length > 1 ? (
            <SecondarySelect
              id={`${idPrefix}-page`}
              label="Page source"
              value={filters.page}
              onChange={(value) => onFiltersChange({ page: value })}
            >
              <option value="all">Toutes pages</option>
              {pages.map((page) => (
                <option key={page} value={String(page)}>
                  Page {page}
                </option>
              ))}
            </SecondarySelect>
          ) : null}

          {tableIndices.length > 1 ? (
            <SecondarySelect
              id={`${idPrefix}-table`}
              label="Table"
              value={filters.table}
              onChange={(value) => onFiltersChange({ table: value })}
            >
              <option value="all">Toutes tables</option>
              {tableIndices.map((tableIndex) => (
                <option key={tableIndex} value={String(tableIndex)}>
                  Table {tableIndex + 1}
                </option>
              ))}
            </SecondarySelect>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={activeSecondaryCount === 0}
            onClick={() =>
              onFiltersChange({
                verification: "all",
                confidence: "all",
                category: "all",
                page: "all",
                table: "all",
              })
            }
          >
            Réinitialiser ces filtres
          </Button>
        </PopoverContent>
      </Popover>

      <span className="text-xs text-muted-foreground sm:ml-auto" role="status">
        {filteredCount} / {totalCount} affiché{filteredCount > 1 ? "s" : ""}
      </span>
    </div>
  );
}

function SecondarySelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} className="text-xs font-medium text-foreground-secondary">
        {label}
      </FieldLabel>
      <NativeSelect id={id} size="sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </NativeSelect>
    </div>
  );
}
