"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import {
  fetchEstimateAssemblies,
  type EstimateAssemblySummary,
} from "@/lib/estimates/client";

import {
  QuickInsertPicker,
  type QuickInsertPickerItem,
} from "./QuickInsertPicker";

type QuickAssemblyPickerProps = {
  isOpen: boolean;
  isReadOnly: boolean;
  onInsert: (assemblyId: string) => Promise<void>;
  onClose: () => void;
};

export function QuickAssemblyPicker({
  isOpen,
  isReadOnly,
  onInsert,
  onClose,
}: QuickAssemblyPickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isInserting, setIsInserting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const swrKey = useMemo(
    () => (isOpen ? ["quick-assembly-picker", isOpen] : null),
    [isOpen]
  );

  const {
    data: assemblies = [],
    isLoading,
    error: loadError,
  } = useSWR<EstimateAssemblySummary[]>(
    swrKey,
    async () => {
      return fetchEstimateAssemblies({ limit: 50, order: "recent" });
    },
    { revalidateOnFocus: false }
  );

  const filteredItems: QuickInsertPickerItem[] = useMemo(() => {
    const needle = searchTerm.toLowerCase();
    const filtered = needle
      ? assemblies.filter(
          (a) =>
            a.name.toLowerCase().includes(needle) ||
            (a.description ?? "").toLowerCase().includes(needle)
        )
      : assemblies;

    return filtered.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      itemCount: a.itemCount,
    }));
  }, [assemblies, searchTerm]);

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    setActionError(null);
  }, []);

  const handleSelect = useCallback(
    async (assemblyId: string) => {
      if (isInserting || isReadOnly) return;
      setActionError(null);
      setIsInserting(true);
      try {
        await onInsert(assemblyId);
        onClose();
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "Impossible d'insérer l'ouvrage."
        );
      } finally {
        setIsInserting(false);
      }
    },
    [isInserting, isReadOnly, onInsert, onClose]
  );

  return (
    <QuickInsertPicker
      key={isOpen ? "assembly-open" : "assembly-closed"}
      isOpen={isOpen}
      title="Inserer un ouvrage"
      emptyLabel="Aucun ouvrage disponible."
      items={filteredItems}
      isLoading={isLoading}
      isInserting={isInserting}
      error={actionError ?? (loadError ? loadError.message : null)}
      onSearch={handleSearch}
      onSelect={handleSelect}
      onClose={onClose}
    />
  );
}
