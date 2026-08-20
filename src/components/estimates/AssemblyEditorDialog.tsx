"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { CatalogueItem } from "@/components/catalogue/types";
import { Modal } from "@/components/ui-legacy/Modal";
import { formatEUR } from "@/lib/money";
import type {
  CreateEstimateAssemblyPayload,
  EstimateAssemblyDetail,
  EstimateAssemblyItem,
  EstimateAssemblyLaborRole,
  EstimateAssemblySummary,
  EstimateAssemblySupplyType,
} from "@/lib/estimates/client";

export type AssemblyEditorInput = {
  name: string;
  description?: string | null;
  referenceCode?: string | null;
  unit?: string | null;
  items: CreateEstimateAssemblyPayload["items"];
  members: NonNullable<CreateEstimateAssemblyPayload["members"]>;
};

type AssemblyCostType = EstimateAssemblyItem["cost_type"];

type AssemblyDraftItem = {
  key: string;
  title: string;
  unit: string;
  kFo: string;
  kMo: string;
  laborRoleId: string;
  supplyTypeId: string;
  defaultQuantity: string;
  laborHours: string;
  costType: AssemblyCostType;
  unitCostEuros: string;
  yieldValue: string;
  yieldUnit: string;
  sourceMetadata: unknown;
};

type AssemblyDraftMember = {
  key: string;
  childAssemblyId: string;
  quantity: string;
};

type AssemblyEditorDialogProps = {
  isSubmitting: boolean;
  initialValue?: EstimateAssemblyDetail | null;
  laborRoles: EstimateAssemblyLaborRole[];
  supplyTypes: EstimateAssemblySupplyType[];
  availableAssemblies?: EstimateAssemblySummary[];
  onClose: () => void;
  onSubmit: (input: AssemblyEditorInput) => Promise<void> | void;
};

const COST_TYPE_OPTIONS: Array<{ value: AssemblyCostType; label: string }> = [
  { value: "material", label: "Fourniture" },
  { value: "labor", label: "Main-d’œuvre" },
  { value: "equipment", label: "Matériel" },
  { value: "subcontract", label: "Sous-traitance" },
];

function createEmptyItem(sequence: number): AssemblyDraftItem {
  return {
    key: `item-${Date.now()}-${sequence}`,
    title: "",
    unit: "",
    kFo: "1",
    kMo: "1",
    laborRoleId: "",
    supplyTypeId: "",
    defaultQuantity: "1",
    laborHours: "0",
    costType: "material",
    unitCostEuros: "0",
    yieldValue: "",
    yieldUnit: "",
    sourceMetadata: {},
  };
}

function toDraftItems(
  initialValue: EstimateAssemblyDetail | null | undefined
): AssemblyDraftItem[] {
  if (!initialValue) {
    return [createEmptyItem(1)];
  }

  return initialValue.items.map((item, index) => {
    const hasStoredLaborHours = typeof item.h_mo === "number";
    const isLegacyLaborItem =
      item.cost_type === "labor" && !hasStoredLaborHours;
    const defaultQuantity = isLegacyLaborItem ? 1 : item.default_quantity;
    const laborHours = hasStoredLaborHours
      ? item.h_mo
      : item.cost_type === "labor"
        ? (item.default_quantity ?? 0)
        : 0;

    return {
      key: `${item.id}-${index}`,
      title: item.title ?? "",
      unit: item.unit ?? "",
      kFo: String(item.k_fo ?? 1),
      kMo: String(item.k_mo ?? 1),
      laborRoleId: item.labor_role_id ?? "",
      supplyTypeId: item.supply_type_id ?? "",
      defaultQuantity:
        defaultQuantity === null || defaultQuantity === undefined
          ? ""
          : String(defaultQuantity),
      laborHours: String(laborHours),
      costType: item.cost_type ?? "material",
      unitCostEuros: String((item.unit_cost_ht_cents ?? 0) / 100),
      yieldValue:
        item.yield_value === null || item.yield_value === undefined
          ? ""
          : String(item.yield_value),
      yieldUnit: item.yield_unit ?? "",
      sourceMetadata: item.source_metadata ?? {},
    };
  });
}

function toDraftMembers(
  initialValue: EstimateAssemblyDetail | null | undefined
): AssemblyDraftMember[] {
  return (initialValue?.members ?? []).map((member, index) => ({
    key: `${member.id}-${index}`,
    childAssemblyId: member.child_assembly_id,
    quantity: String(member.quantity),
  }));
}


function readFiniteNumber(value: string, fallback: number) {
  const normalized = value.trim().replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}


function formatHourlyRate(cents: number) {
  return `${formatEUR(cents)}/h`;
}

function computeDraftDirectCost(
  item: AssemblyDraftItem,
  laborRoles: EstimateAssemblyLaborRole[]
) {
  const quantity = Math.max(readFiniteNumber(item.defaultQuantity, 0), 0);
  const laborHours = Math.max(readFiniteNumber(item.laborHours, 0), 0);
  const unitCostCents = Math.round(
    Math.max(readFiniteNumber(item.unitCostEuros, 0), 0) * 100
  );
  const supplyCostCents =
    item.costType === "labor"
      ? 0
      : Math.round(
          quantity *
            unitCostCents *
            Math.max(readFiniteNumber(item.kFo, 1), 0)
        );
  const selectedLaborRateCents =
    laborRoles.find((role) => role.id === item.laborRoleId)?.hourly_rate_cents ??
    (item.costType === "labor" ? unitCostCents : 0);
  const laborCostCents = Math.round(
    laborHours *
      selectedLaborRateCents *
      Math.max(readFiniteNumber(item.kMo, 1), 0)
  );

  return supplyCostCents + laborCostCents;
}

type AssemblyCatalogueInputProps = {
  id: string;
  className: string;
  value: string;
  searchEnabled: boolean;
  onChange: (value: string) => void;
  onSelect: (item: CatalogueItem) => void;
};

function formatCatalogueOptionLabel(item: CatalogueItem) {
  const details = [item.reference, item.unit]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" · ");
  const price =
    typeof item.unit_price_cents === "number"
      ? formatEUR(item.unit_price_cents)
      : null;
  return [details, price].filter(Boolean).join(" · ");
}

function toCatalogueRecoveryQuery(title: string) {
  return title
    .replace(/[%_,]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

function AssemblyCatalogueInput({
  id,
  className,
  value,
  searchEnabled,
  onChange,
  onSelect,
}: AssemblyCatalogueInputProps) {
  const [suggestions, setSuggestions] = useState<CatalogueItem[]>([]);
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const listId = `${id}-catalogue-list`;
  const hintId = `${id}-catalogue-hint`;
  const normalizedQuery = value.trim();
  const canSearch = searchEnabled && isFocused && normalizedQuery.length >= 2;
  const visibleSuggestions =
    canSearch && resolvedQuery === normalizedQuery ? suggestions : [];
  const visibleError =
    canSearch && resolvedQuery === normalizedQuery ? searchError : null;

  useEffect(() => {
    if (!canSearch) return;

    const query = normalizedQuery;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      setSearchError(null);
      const searchParams = new URLSearchParams({
        search: query,
        limit: "8",
      });

      void fetchApi<{ items: CatalogueItem[] }>(
        `/api/catalogue?${searchParams.toString()}`,
        { signal: abortController.signal }
      )
        .then((payload) => {
          setSuggestions(payload.items ?? []);
          setResolvedQuery(query);
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return;
          setSuggestions([]);
          setResolvedQuery(query);
          setSearchError(
            error instanceof Error
              ? error.message
              : "Impossible de rechercher dans le catalogue."
          );
        })
        .finally(() => {
          if (!abortController.signal.aborted) setIsLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [canSearch, normalizedQuery]);

  return (
    <>
      <input
        id={id}
        className={className}
        value={value}
        list={searchEnabled ? listId : undefined}
        aria-describedby={searchEnabled ? hintId : undefined}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          const exactMatch = visibleSuggestions.find(
            (suggestion) =>
              suggestion.designation.trim().toLocaleLowerCase("fr") ===
              nextValue.trim().toLocaleLowerCase("fr")
          );
          if (exactMatch) onSelect(exactMatch);
        }}
        placeholder={
          searchEnabled ? "Rechercher une désignation" : "Désignation"
        }
        autoComplete="off"
      />
      {searchEnabled ? (
        <>
          <datalist id={listId}>
            {visibleSuggestions.map((suggestion) => (
              <option
                key={suggestion.id}
                value={suggestion.designation}
                label={formatCatalogueOptionLabel(suggestion)}
              />
            ))}
          </datalist>
          <span id={hintId} className="sr-only">
            Saisissez au moins 2 caractères pour rechercher dans le catalogue.
          </span>
          <span className="sr-only" aria-live="polite">
            {canSearch && isLoading
              ? "Recherche catalogue en cours."
              : visibleError
                ? visibleError
                : visibleSuggestions.length > 0
                  ? `${visibleSuggestions.length} suggestion${visibleSuggestions.length > 1 ? "s" : ""} catalogue.`
                  : ""}
          </span>
        </>
      ) : null}
    </>
  );
}

export function AssemblyEditorDialog({
  isSubmitting,
  initialValue,
  laborRoles,
  supplyTypes,
  availableAssemblies = [],
  onClose,
  onSubmit,
}: AssemblyEditorDialogProps) {
  const isEditMode = Boolean(initialValue);
  const [name, setName] = useState(() => initialValue?.name ?? "");
  const [description, setDescription] = useState(
    () => initialValue?.description ?? ""
  );
  const [referenceCode, setReferenceCode] = useState(
    () => initialValue?.referenceCode ?? ""
  );
  const [assemblyUnit, setAssemblyUnit] = useState(
    () => initialValue?.unit ?? ""
  );
  const [items, setItems] = useState<AssemblyDraftItem[]>(() =>
    toDraftItems(initialValue)
  );
  const [members, setMembers] = useState<AssemblyDraftMember[]>(() =>
    toDraftMembers(initialValue)
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialValue) return;

    const initialItems = toDraftItems(initialValue);
    const candidates = initialItems
      .map((item, index) => ({ index, item }))
      .filter(
        ({ item }) =>
          item.costType !== "labor" &&
          readFiniteNumber(item.unitCostEuros, 0) === 0 &&
          item.title.trim().length >= 2
      );
    if (candidates.length === 0) return;

    const abortController = new AbortController();
    let cancelled = false;

    void Promise.all(
      candidates.map(async ({ index, item }) => {
        const searchParams = new URLSearchParams({
          search: toCatalogueRecoveryQuery(item.title),
          limit: "8",
        });

        try {
          const payload = await fetchApi<{ items: CatalogueItem[] }>(
            `/api/catalogue?${searchParams.toString()}`,
            { signal: abortController.signal }
          );
          const exactMatch = (payload.items ?? []).find(
            (suggestion) =>
              suggestion.designation.trim().toLocaleLowerCase("fr") ===
              item.title.trim().toLocaleLowerCase("fr")
          );
          if (
            !exactMatch ||
            typeof exactMatch.unit_price_cents !== "number" ||
            exactMatch.unit_price_cents <= 0
          ) {
            return null;
          }
          return {
            index,
            item,
            catalogueItem: exactMatch,
            unitPriceCents: exactMatch.unit_price_cents,
          };
        } catch {
          return null;
        }
      })
    ).then((recoveries) => {
      if (cancelled) return;
      setItems((previous) =>
        previous.map((item, index) => {
          const recovery = recoveries.find((entry) => entry?.index === index);
          if (
            !recovery ||
            item.title.trim().toLocaleLowerCase("fr") !==
              recovery.item.title.trim().toLocaleLowerCase("fr") ||
            readFiniteNumber(item.unitCostEuros, 0) !== 0
          ) {
            return item;
          }
          return {
            ...item,
            unit: item.unit || recovery.catalogueItem.unit?.trim() || "",
            unitCostEuros: String(recovery.unitPriceCents / 100),
          };
        })
      );
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [initialValue]);

  const modalTitle = isEditMode ? "Modifier l'ouvrage" : "Nouvel ouvrage";
  const assemblyMetricsById = useMemo(() => {
    const metrics = new Map<
      string,
      { directCostCents: number; laborHours: number }
    >();

    availableAssemblies.forEach((assembly) => {
      metrics.set(assembly.id, {
        directCostCents: assembly.directCostCents ?? 0,
        laborHours: assembly.averageTimeHours ?? 0,
      });
    });
    (initialValue?.members ?? []).forEach((member) => {
      if (!member.child_assembly || metrics.has(member.child_assembly_id)) {
        return;
      }
      metrics.set(member.child_assembly_id, {
        directCostCents: member.child_assembly.ds_cents,
        laborHours: member.child_assembly.avg_time_hours ?? 0,
      });
    });
    return metrics;
  }, [availableAssemblies, initialValue]);

  const directCostCents = useMemo(
    () =>
      items.reduce(
        (total, item) => total + computeDraftDirectCost(item, laborRoles),
        0
      ) +
      members.reduce((total, member) => {
        const quantity = Math.max(readFiniteNumber(member.quantity, 0), 0);
        return (
          total +
          quantity *
            (assemblyMetricsById.get(member.childAssemblyId)
              ?.directCostCents ?? 0)
        );
      }, 0),
    [assemblyMetricsById, items, laborRoles, members]
  );
  const laborHours = useMemo(
    () =>
      items.reduce(
        (total, item) =>
          total + Math.max(readFiniteNumber(item.laborHours, 0), 0),
        0
      ) +
      members.reduce((total, member) => {
        const quantity = Math.max(readFiniteNumber(member.quantity, 0), 0);
        return (
          total +
          quantity *
            (assemblyMetricsById.get(member.childAssemblyId)?.laborHours ?? 0)
        );
      }, 0),
    [assemblyMetricsById, items, members]
  );

  function updateItem(index: number, patch: Partial<AssemblyDraftItem>) {
    setItems((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  }

  function updateCostType(index: number, costType: AssemblyCostType) {
    updateItem(index, { costType });
  }

  function addItem() {
    setItems((previous) => [
      ...previous,
      createEmptyItem(previous.length + 1),
    ]);
  }

  function removeItem(index: number) {
    setItems((previous) =>
      previous.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  function addMember() {
    setMembers((previous) => [
      ...previous,
      {
        key: `member-${Date.now()}-${previous.length + 1}`,
        childAssemblyId: "",
        quantity: "1",
      },
    ]);
  }

  function updateMember(index: number, patch: Partial<AssemblyDraftMember>) {
    setMembers((previous) =>
      previous.map((member, memberIndex) =>
        memberIndex === index ? { ...member, ...patch } : member
      )
    );
  }

  function removeMember(index: number) {
    setMembers((previous) =>
      previous.filter((_, memberIndex) => memberIndex !== index)
    );
  }


  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("Le nom de l'ouvrage est obligatoire.");
      return;
    }
    if (items.length > 50) {
      setValidationError("L'ouvrage ne peut pas contenir plus de 50 lignes.");
      return;
    }
    if (members.length > 20) {
      setValidationError(
        "L'ouvrage ne peut pas contenir plus de 20 sous-ouvrages."
      );
      return;
    }
    if (items.length + members.length === 0) {
      setValidationError(
        "L'ouvrage doit contenir au moins une ligne ou un sous-ouvrage."
      );
      return;
    }

    const payloadItems: AssemblyEditorInput["items"] = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const title = item.title.trim();
      if (!title) {
        setValidationError(
          `La désignation de la ligne ${index + 1} est obligatoire.`
        );
        return;
      }


      payloadItems.push({
        title,
        unit: item.unit.trim() || null,
        kFo: Math.max(readFiniteNumber(item.kFo, 1), 0),
        kMo: Math.max(readFiniteNumber(item.kMo, 1), 0),
        laborRoleId: item.laborRoleId.trim() || null,
        supplyTypeId: item.supplyTypeId.trim() || null,
        defaultQuantity: item.defaultQuantity.trim()
          ? Math.max(readFiniteNumber(item.defaultQuantity, 1), 0)
          : null,
        laborHours: Math.max(readFiniteNumber(item.laborHours, 0), 0),
        position: index + 1,
        costType: item.costType,
        unitCostHtCents: Math.round(
          Math.max(readFiniteNumber(item.unitCostEuros, 0), 0) * 100
        ),
        yieldValue: item.yieldValue.trim()
          ? Math.max(readFiniteNumber(item.yieldValue, 0), 0)
          : null,
        yieldUnit: item.yieldUnit.trim() || null,
        sourceMetadata: item.sourceMetadata,
      });
    }

    const payloadMembers: AssemblyEditorInput["members"] = [];
    const selectedAssemblyIds = new Set<string>();

    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      if (!member.childAssemblyId) {
        setValidationError(
          `Sélectionnez le sous-ouvrage de la ligne ${index + 1}.`
        );
        return;
      }
      if (selectedAssemblyIds.has(member.childAssemblyId)) {
        setValidationError("Un sous-ouvrage ne peut être ajouté qu'une fois.");
        return;
      }
      selectedAssemblyIds.add(member.childAssemblyId);
      payloadMembers.push({
        childAssemblyId: member.childAssemblyId,
        quantity: Math.max(readFiniteNumber(member.quantity, 1), 0),
        position: items.length + index + 1,
      });
    }


    setValidationError(null);
    await onSubmit({
      name: trimmedName,
      description: description.trim() || null,
      referenceCode: referenceCode.trim() || null,
      unit: assemblyUnit.trim() || null,
      items: payloadItems,
      members: payloadMembers,
    });
  }

  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <Modal.Content
        closeOnOverlayClick={!isSubmitting}
        closeOnEscapeKey={!isSubmitting}
        containerClassName="sm:max-w-6xl"
        className="max-h-[calc(100dvh-1rem)] overflow-y-auto p-0"
      >
        <div className="sticky top-0 z-20 border-b border-[var(--slate-200)] bg-white px-4 py-3 sm:px-5">
          <Modal.Header className="mb-0">
            <div>
              <Modal.Title>{modalTitle}</Modal.Title>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                Définissez les composants, leurs coûts et le temps de main-d’œuvre.
              </p>
            </div>
            <Modal.Close disabled={isSubmitting}>Fermer</Modal.Close>
          </Modal.Header>
        </div>

        <form className="grid gap-3 p-4 sm:p-5" onSubmit={handleSubmit}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="md:col-span-2">
              <label className="form-label" htmlFor="assembly-name">
                Nom de l&apos;ouvrage *
              </label>
              <input
                id="assembly-name"
                className="form-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-modal-autofocus="true"
                required
              />
            </div>
            <div>
              <label className="form-label" htmlFor="assembly-reference-code">
                Code / référence
              </label>
              <input
                id="assembly-reference-code"
                className="form-input"
                value={referenceCode}
                onChange={(event) => setReferenceCode(event.target.value)}
                placeholder="Ex. MAC-CLOI-048"
              />
            </div>
            <div>
              <label className="form-label" htmlFor="assembly-unit">
                Unité de l&apos;ouvrage
              </label>
              <input
                id="assembly-unit"
                className="form-input"
                value={assemblyUnit}
                onChange={(event) => setAssemblyUnit(event.target.value)}
                placeholder="u, ml, m²…"
              />
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <label className="form-label" htmlFor="assembly-description">
                Description
              </label>
              <input
                id="assembly-description"
                className="form-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optionnel"
              />
            </div>
          </div>

          <div className="grid gap-2 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                Coût direct estimé
              </p>
              <p className="text-base font-semibold text-[var(--slate-900)]">
                {formatEUR(directCostCents)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                Temps MO total
              </p>
              <p className="text-base font-semibold text-[var(--slate-900)]">
                {new Intl.NumberFormat("fr-FR", {
                  maximumFractionDigits: 2,
                }).format(laborHours)} h
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                Contenu
              </p>
              <p className="text-base font-semibold text-[var(--slate-900)]">
                {items.length} ligne(s) · {members.length} sous-ouvrage(s)
              </p>
            </div>
          </div>

          <div
            data-testid="assembly-items-grid"
            className="overflow-x-auto rounded-xl border border-[var(--slate-200)] bg-white"
          >
            <div
              data-testid="assembly-items-header"
              className="hidden min-w-[1100px] grid-cols-[minmax(240px,1fr)_90px_52px_72px_82px_96px_64px_72px_112px_64px_90px_64px] items-stretch gap-0 bg-[var(--slate-50)] p-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--slate-500)] lg:grid lg:[&>span]:flex lg:[&>span]:h-10 lg:[&>span]:items-center lg:[&>span]:border-r lg:[&>span]:border-[var(--slate-200)] lg:[&>span]:px-2 lg:[&>span:last-child]:border-r-0"
            >
              <span>Désignation</span>
              <span>Type</span>
              <span>Unité</span>
              <span>Qté</span>
              <span className="bg-blue-100/80 text-blue-800">
                PR FO
              </span>
              <span className="bg-blue-100/80 text-blue-800">
                Type FO
              </span>
              <span className="bg-blue-100/80 text-blue-800">
                K FO
              </span>
              <span className="bg-amber-100/80 text-amber-800">
                H MO
              </span>
              <span className="bg-amber-100/80 text-amber-800">
                Rôle MO
              </span>
              <span className="bg-amber-100/80 text-amber-800">
                K MO
              </span>
              <span>Total ligne</span>
              <span aria-hidden="true" />
            </div>

            <div className="divide-y divide-[var(--slate-200)]">
              {items.map((item, index) => {
                const rowPrefix = `assembly-item-${index}`;
                const isLabor = item.costType === "labor";
                const compactInputClass =
                  "form-input !h-9 !rounded-lg !px-2 !text-[13px] lg:!h-10 lg:!rounded-none lg:!border-0 lg:!shadow-none lg:focus:!outline-2 lg:focus:!-outline-offset-2";
                const compactSelectClass = `${compactInputClass} form-select lg:!pr-7 lg:[background-position:right_6px_center]`;
                const numericInputClass = `${compactInputClass} text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;
                const foSelectClass = `${compactSelectClass} !border-blue-200 !bg-blue-50/80 focus:!border-blue-400`;
                const foNumericInputClass = `${numericInputClass} !border-blue-200 !bg-blue-50/80 focus:!border-blue-400`;
                const moSelectClass = `${compactSelectClass} !border-amber-200 !bg-amber-50/80 focus:!border-amber-400`;
                const moNumericInputClass = `${numericInputClass} !border-amber-200 !bg-amber-50/80 focus:!border-amber-400`;
                return (
                  <section
                    key={item.key}
                    data-testid="assembly-item-row"
                    className="grid gap-3 bg-white p-3 sm:grid-cols-2 lg:min-w-[1100px] lg:grid-cols-[minmax(240px,1fr)_90px_52px_72px_82px_96px_64px_72px_112px_64px_90px_64px] lg:items-stretch lg:gap-0 lg:p-0 lg:[&>div]:min-w-0 lg:[&>div]:border-r lg:[&>div]:border-[var(--slate-200)]"
                    aria-labelledby={`${rowPrefix}-title`}
                  >
                    <h3
                      id={`${rowPrefix}-title`}
                      className="col-span-full text-sm font-semibold text-[var(--slate-800)] lg:sr-only"
                    >
                      Ligne {index + 1}
                    </h3>

                    <div className="sm:col-span-2 lg:col-span-1">
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-title-input`}
                      >
                        Désignation *
                      </label>
                      <AssemblyCatalogueInput
                        id={`${rowPrefix}-title-input`}
                        className={compactInputClass}
                        value={item.title}
                        searchEnabled={!isLabor}
                        onChange={(title) => updateItem(index, { title })}
                        onSelect={(suggestion) =>
                          updateItem(index, {
                            title: suggestion.designation,
                            unit: suggestion.unit?.trim() || item.unit,
                            unitCostEuros:
                              typeof suggestion.unit_price_cents === "number"
                                ? String(suggestion.unit_price_cents / 100)
                                : item.unitCostEuros,
                          })
                        }
                      />
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-cost-type`}
                      >
                        Type de coût
                      </label>
                      <select
                        id={`${rowPrefix}-cost-type`}
                        className={compactSelectClass}
                        value={item.costType}
                        onChange={(event) =>
                          updateCostType(index, event.target.value as AssemblyCostType)
                        }
                      >
                        {COST_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-unit`}
                      >
                        Unité
                      </label>
                      <input
                        id={`${rowPrefix}-unit`}
                        className={compactInputClass}
                        value={item.unit}
                        onChange={(event) =>
                          updateItem(index, { unit: event.target.value })
                        }
                        placeholder="u"
                      />
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-quantity`}
                      >
                        Quantité par défaut
                      </label>
                      <input
                        id={`${rowPrefix}-quantity`}
                        className={numericInputClass}
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.defaultQuantity}
                        onChange={(event) =>
                          updateItem(index, {
                            defaultQuantity: event.target.value,
                          })
                        }
                      />
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-unit-cost`}
                      >
                        Prix de revient FO (€)
                      </label>
                      <input
                        id={`${rowPrefix}-unit-cost`}
                        className={foNumericInputClass}
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitCostEuros}
                        onChange={(event) =>
                          updateItem(index, { unitCostEuros: event.target.value })
                        }
                      />
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-supply-type`}
                      >
                        Type FO
                      </label>
                      <select
                        id={`${rowPrefix}-supply-type`}
                        className={foSelectClass}
                        value={item.supplyTypeId}
                        onChange={(event) =>
                          updateItem(index, { supplyTypeId: event.target.value })
                        }
                      >
                        <option value="">Aucun type</option>
                        {supplyTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-k-fo`}
                      >
                        Coefficient FO
                      </label>
                      <input
                        id={`${rowPrefix}-k-fo`}
                        className={foNumericInputClass}
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.kFo}
                        onChange={(event) =>
                          updateItem(index, { kFo: event.target.value })
                        }
                      />
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-labor-hours`}
                      >
                        Temps MO (h)
                      </label>
                      <input
                        id={`${rowPrefix}-labor-hours`}
                        className={moNumericInputClass}
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.laborHours}
                        onChange={(event) =>
                          updateItem(index, {
                            laborHours: event.target.value,
                          })
                        }
                      />
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-labor-role`}
                      >
                        Rôle de main-d’œuvre
                      </label>
                      <select
                        id={`${rowPrefix}-labor-role`}
                        className={moSelectClass}
                        value={item.laborRoleId}
                        onChange={(event) =>
                          updateItem(index, { laborRoleId: event.target.value })
                        }
                        title="L’identifiant technique est géré automatiquement."
                      >
                        <option value="">Aucun rôle</option>
                        {laborRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name} — {formatHourlyRate(role.hourly_rate_cents)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        className="form-label mb-1 text-xs lg:sr-only"
                        htmlFor={`${rowPrefix}-k-mo`}
                      >
                        Coefficient MO
                      </label>
                      <input
                        id={`${rowPrefix}-k-mo`}
                        className={moNumericInputClass}
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.kMo}
                        onChange={(event) =>
                          updateItem(index, { kMo: event.target.value })
                        }
                      />
                    </div>

                    <div>
                      <span className="form-label mb-1 text-xs lg:sr-only">
                        Coût direct de la ligne
                      </span>
                      <output className="flex h-9 items-center justify-end whitespace-nowrap rounded-lg bg-[var(--slate-50)] px-2 text-right text-[13px] font-semibold tabular-nums text-[var(--slate-800)] ring-1 ring-inset ring-[var(--slate-200)] lg:h-10 lg:rounded-none lg:ring-0">
                        {formatEUR(computeDraftDirectCost(item, laborRoles))}
                      </output>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm !h-9 !min-h-9 !px-2 !text-xs lg:!h-10 lg:!min-h-10 lg:!rounded-none lg:!border-0 lg:!px-1"
                      onClick={() => removeItem(index)}
                      disabled={isSubmitting}
                      aria-label={`Retirer la ligne ${index + 1}`}
                    >
                      Retirer
                    </button>
                  </section>
                );
              })}
            </div>
          </div>

          <div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={addItem}
              disabled={isSubmitting || items.length >= 50}
            >
              + Ajouter une ligne
            </button>
          </div>

          <section className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                  Sous-ouvrages
                </h3>
                <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                  Références vivantes dans la bibliothèque, limitées à deux niveaux.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={addMember}
                disabled={isSubmitting || members.length >= 20}
              >
                + Ajouter un sous-ouvrage
              </button>
            </div>

            {members.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--slate-300)] bg-white px-3 py-4 text-sm text-[var(--slate-500)]">
                Aucun sous-ouvrage. Vous pouvez composer cet ouvrage à partir
                d&apos;ouvrages existants de la bibliothèque.
              </p>
            ) : (
              <div className="grid gap-2">
                {members.map((member, index) => {
                  const storedChild = initialValue?.members?.find(
                    (candidate) =>
                      candidate.child_assembly_id === member.childAssemblyId
                  )?.child_assembly;
                  const hasStoredChoice =
                    storedChild &&
                    !availableAssemblies.some(
                      (candidate) => candidate.id === storedChild.id
                    );
                  const metrics = assemblyMetricsById.get(
                    member.childAssemblyId
                  );
                  const memberCost = Math.round(
                    Math.max(readFiniteNumber(member.quantity, 0), 0) *
                      (metrics?.directCostCents ?? 0)
                  );

                  return (
                    <div
                      key={member.key}
                      className="grid gap-2 rounded-lg border border-[var(--slate-200)] bg-white p-3 md:grid-cols-[minmax(240px,1fr)_120px_140px_auto] md:items-end"
                    >
                      <div>
                        <label
                          className="form-label"
                          htmlFor={`assembly-member-${index}`}
                        >
                          Ouvrage réutilisable
                        </label>
                        <select
                          id={`assembly-member-${index}`}
                          className="form-input"
                          value={member.childAssemblyId}
                          onChange={(event) =>
                            updateMember(index, {
                              childAssemblyId: event.target.value,
                            })
                          }
                          required
                        >
                          <option value="">Sélectionner un ouvrage</option>
                          {hasStoredChoice ? (
                            <option value={storedChild.id}>
                              {storedChild.name}
                            </option>
                          ) : null}
                          {availableAssemblies
                            .filter(
                              (candidate) => candidate.id !== initialValue?.id
                            )
                            .map((candidate) => (
                              <option
                                key={candidate.id}
                                value={candidate.id}
                                disabled={members.some(
                                  (selected, selectedIndex) =>
                                    selectedIndex !== index &&
                                    selected.childAssemblyId === candidate.id
                                )}
                              >
                                {candidate.referenceCode
                                  ? `${candidate.referenceCode} — ${candidate.name}`
                                  : candidate.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label
                          className="form-label"
                          htmlFor={`assembly-member-quantity-${index}`}
                        >
                          Quantité
                        </label>
                        <input
                          id={`assembly-member-quantity-${index}`}
                          className="form-input text-right tabular-nums"
                          type="number"
                          min={0}
                          step="0.001"
                          value={member.quantity}
                          onChange={(event) =>
                            updateMember(index, {
                              quantity: event.target.value,
                            })
                          }
                          required
                        />
                      </div>
                      <div>
                        <span className="form-label">Coût intégré</span>
                        <output className="flex h-10 items-center justify-end rounded-lg bg-[var(--slate-50)] px-3 font-semibold tabular-nums text-[var(--slate-800)] ring-1 ring-inset ring-[var(--slate-200)]">
                          {formatEUR(memberCost)}
                        </output>
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => removeMember(index)}
                        disabled={isSubmitting}
                        aria-label={`Retirer le sous-ouvrage ${index + 1}`}
                      >
                        Retirer
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>


          {validationError ? (
            <div className="alert alert-error" role="alert">
              {validationError}
            </div>
          ) : null}

          <Modal.Footer className="sticky bottom-0 -mx-4 -mb-4 border-t border-[var(--slate-200)] bg-white px-4 py-3 sm:-mx-5 sm:-mb-5 sm:px-5">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Enregistrement..." : "Enregistrer"}
            </button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
