"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fetchEstimateAssemblies,
  fetchEstimateAssembly,
  type EstimateAssemblyDetail,
  type EstimateAssemblySummary,
} from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";

type AssemblyPickerProps = {
  isOpen: boolean;
  isReadOnly: boolean;
  anchorItemId: string | null;
  anchorLabel?: string | null;
  onClose: () => void;
  onInsert: (assemblyId: string) => Promise<void>;
};

function normalizedText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatCurrency(cents: number | null | undefined) {
  return formatEUR(cents ?? 0);
}

function formatHours(value: number | null | undefined) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

export function AssemblyPicker({
  isOpen,
  isReadOnly,
  anchorItemId,
  anchorLabel,
  onClose,
  onInsert,
}: AssemblyPickerProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, EstimateAssemblyDetail>>({});
  const [isInserting, setIsInserting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const swrKey = useMemo(() => ["assembly-picker", isOpen], [isOpen]);
  const {
    data: assemblies = [],
    isLoading,
    error: loadError,
  } = useSWR<EstimateAssemblySummary[]>(
    swrKey,
    async () => {
      if (!isOpen) return [];
      return fetchEstimateAssemblies({
        limit: 100,
        order: "recent",
      });
    },
    {
      revalidateOnFocus: false,
    }
  );

  useEffect(() => {
    if (!isOpen) return;
    setSearchInput("");
    setDebouncedSearch("");
    setSelectedAssemblyId(null);
    setActionError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isOpen, searchInput]);

  useEffect(() => {
    if (!isOpen || !debouncedSearch) return;

    const candidates = assemblies.filter((assembly) => {
      const name = normalizedText(assembly.name);
      const description = normalizedText(assembly.description);
      if (name.includes(debouncedSearch) || description.includes(debouncedSearch)) {
        return false;
      }
      return !detailById[assembly.id];
    });

    if (candidates.length === 0) return;

    let active = true;
    void Promise.all(
      candidates.map(async (assembly) => {
        try {
          const detail = await fetchEstimateAssembly(assembly.id);
          return [assembly.id, detail] as const;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (!active) return;
      setDetailById((previous) => {
        const next = { ...previous };
        entries.forEach((entry) => {
          if (!entry) return;
          const [assemblyId, detail] = entry;
          next[assemblyId] = detail;
        });
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [assemblies, debouncedSearch, detailById, isOpen]);

  const filteredAssemblies = useMemo(() => {
    if (!debouncedSearch) return assemblies;

    return assemblies.filter((assembly) => {
      const name = normalizedText(assembly.name);
      const description = normalizedText(assembly.description);
      if (name.includes(debouncedSearch) || description.includes(debouncedSearch)) {
        return true;
      }

      const detail = detailById[assembly.id];
      if (!detail) return false;
      return detail.items.some((item) =>
        normalizedText(item.title).includes(debouncedSearch)
      );
    });
  }, [assemblies, debouncedSearch, detailById]);

  useEffect(() => {
    if (!isOpen) return;
    if (!selectedAssemblyId) return;
    if (detailById[selectedAssemblyId]) return;

    let active = true;
    void fetchEstimateAssembly(selectedAssemblyId)
      .then((detail) => {
        if (!active) return;
        setDetailById((previous) => ({
          ...previous,
          [selectedAssemblyId]: detail,
        }));
      })
      .catch(() => {
        if (!active) return;
        setActionError("Impossible de charger l'aperçu de l'ouvrage.");
      });

    return () => {
      active = false;
    };
  }, [detailById, isOpen, selectedAssemblyId]);

  const selectedDetail =
    selectedAssemblyId ? detailById[selectedAssemblyId] ?? null : null;
  const selectedAssembly = selectedAssemblyId
    ? assemblies.find((assembly) => assembly.id === selectedAssemblyId) ?? null
    : null;

  async function handleInsert() {
    if (!selectedAssemblyId || isInserting) return;
    setActionError(null);
    setIsInserting(true);
    try {
      await onInsert(selectedAssemblyId);
      onClose();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible d'insérer l'ouvrage."
      );
    } finally {
      setIsInserting(false);
    }
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        initialFocus={searchInputRef}
        className="gap-0 bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <SheetTitle className="text-lg font-semibold">Ajouter un ouvrage</SheetTitle>
            <SheetDescription className="mt-1">
              Recherchez un ouvrage, vérifiez son coût puis ajoutez-le au chiffrage.
            </SheetDescription>
            <p className="mt-1 text-xs font-medium text-foreground-secondary">
              Emplacement :{" "}
              {anchorLabel ??
                (anchorItemId ? "après la ligne active" : "à la fin du devis")}
            </p>
          </div>
          <SheetClose
            render={<Button variant="outline" size="md" className="shrink-0" />}
            aria-label="Fermer le sélecteur d'ouvrages"
          >
            Fermer
          </SheetClose>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[300px_1fr]">
          <div className="min-h-0 border-b border-border md:border-r md:border-b-0">
            <div className="grid gap-2 p-4">
              <FieldLabel htmlFor="assembly-picker-search">Rechercher</FieldLabel>
              <Input
                ref={searchInputRef}
                id="assembly-picker-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Nom, référence ou composant"
              />
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-auto px-2 pb-3">
              {isLoading ? (
                <LoadingState className="py-4" />
              ) : loadError ? (
                <Alert variant="danger" className="mx-2">{loadError.message}</Alert>
              ) : filteredAssemblies.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  Aucun ouvrage trouvé.
                </p>
              ) : (
                filteredAssemblies.map((assembly) => {
                  const isSelected = selectedAssemblyId === assembly.id;
                  return (
                    <button
                      key={assembly.id}
                      type="button"
                      aria-pressed={isSelected}
                      className={`mb-2 w-full rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none ${
                        isSelected
                          ? "border-primary bg-info-light"
                          : "border-border bg-surface hover:border-border-strong hover:bg-surface-subtle"
                      }`}
                      onClick={() => setSelectedAssemblyId(assembly.id)}
                    >
                      <span className="block font-medium text-foreground">{assembly.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>
                          {assembly.itemCount} composant{assembly.itemCount > 1 ? "s" : ""}
                        </span>
                        {assembly.unit ? <span>· {assembly.unit}</span> : null}
                        <span className="tabular-nums">· {formatCurrency(assembly.targetPriceCents)}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex-1 overflow-auto p-4">
              {!selectedAssemblyId ? (
                <p className="text-sm text-muted-foreground">
                  Sélectionnez un ouvrage pour afficher son aperçu et son impact financier.
                </p>
              ) : !selectedDetail ? (
                <LoadingState label="Chargement de l’aperçu…" className="justify-start py-0" />
              ) : (
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {selectedDetail.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedDetail.description?.trim() || "Sans description"}
                  </p>

                  <dl className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                    {[
                      { label: "Coût direct", value: formatCurrency(selectedDetail.directCostCents) },
                      { label: "Temps MO", value: `${formatHours(selectedDetail.averageTimeHours)} h` },
                      { label: "Prix cible HT", value: formatCurrency(selectedDetail.targetPriceCents) },
                      { label: "Composants", value: String(selectedDetail.items.length) },
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-lg border border-border bg-surface-subtle px-3 py-2"
                      >
                        <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                        <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
                          {metric.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div
                    className="mt-4 table-scroll rounded-lg border border-border"
                    role="region"
                    aria-label="Composants de l’ouvrage"
                    tabIndex={0}
                  >
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Pos.</th>
                          <th>Désignation</th>
                          <th>Unité</th>
                          <th>K FO</th>
                          <th>K MO</th>
                          <th>Qté défaut</th>
                          <th>Coût unitaire</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDetail.items.map((item) => (
                          <tr key={item.id}>
                            <td className="font-mono">{item.position}</td>
                            <td>{item.title}</td>
                            <td>{item.unit ?? "-"}</td>
                            <td className="tabular-nums">{item.k_fo ?? 1}</td>
                            <td className="tabular-nums">{item.k_mo ?? 1}</td>
                            <td className="tabular-nums">{item.default_quantity ?? 1}</td>
                            <td className="tabular-nums">{formatCurrency(item.unit_cost_ht_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border p-4">
              {actionError ? (
                <Alert variant="danger" className="mb-3">{actionError}</Alert>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href="/dashboard/estimates/assemblies"
                  className={buttonVariants({ variant: "link", size: "sm" })}
                >
                  Gérer la bibliothèque d&apos;ouvrages
                </Link>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onClose}
                    disabled={isInserting}
                  >
                    Annuler
                  </Button>
                  <Button
                    size="lg"
                    className="max-w-full"
                    onClick={() => void handleInsert()}
                    disabled={!selectedAssemblyId || isReadOnly}
                    loading={isInserting}
                  >
                    <span className="min-w-0 truncate">
                      {selectedAssembly
                        ? `Ajouter « ${selectedAssembly.name} » — ${formatCurrency(
                            selectedAssembly.targetPriceCents
                          )}`
                        : "Ajouter l'ouvrage"}
                    </span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
