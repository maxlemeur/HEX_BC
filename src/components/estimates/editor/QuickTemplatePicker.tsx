"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import {
  fetchEstimateTemplates,
  type EstimateTemplateSummary,
} from "@/lib/estimates/client";

import {
  QuickInsertPicker,
  type QuickInsertPickerItem,
} from "./QuickInsertPicker";

type QuickTemplatePickerProps = {
  isOpen: boolean;
  isReadOnly: boolean;
  onInsert: (templateId: string) => Promise<void>;
  onClose: () => void;
};

export function QuickTemplatePicker({
  isOpen,
  isReadOnly,
  onInsert,
  onClose,
}: QuickTemplatePickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isInserting, setIsInserting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const swrKey = useMemo(
    () => (isOpen ? ["quick-template-picker", isOpen] : null),
    [isOpen]
  );

  const {
    data: templates = [],
    isLoading,
    error: loadError,
  } = useSWR<EstimateTemplateSummary[]>(
    swrKey,
    async () => {
      return fetchEstimateTemplates({ limit: 50, order: "recent" });
    },
    { revalidateOnFocus: false }
  );

  const filteredItems: QuickInsertPickerItem[] = useMemo(() => {
    const needle = searchTerm.toLowerCase();
    const filtered = needle
      ? templates.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            (t.description ?? "").toLowerCase().includes(needle)
        )
      : templates;

    return filtered.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      itemCount: t.itemCount,
    }));
  }, [templates, searchTerm]);

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    setActionError(null);
  }, []);

  const handleSelect = useCallback(
    async (templateId: string) => {
      if (isInserting || isReadOnly) return;
      setActionError(null);
      setIsInserting(true);
      try {
        await onInsert(templateId);
        onClose();
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "Impossible d'inserer le template."
        );
      } finally {
        setIsInserting(false);
      }
    },
    [isInserting, isReadOnly, onInsert, onClose]
  );

  return (
    <QuickInsertPicker
      key={isOpen ? "template-open" : "template-closed"}
      isOpen={isOpen}
      title="Inserer un template"
      emptyLabel="Aucun template disponible."
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
