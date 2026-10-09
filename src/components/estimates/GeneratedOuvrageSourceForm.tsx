"use client";

import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

import {
  GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL,
  type ExistingSection,
} from "./generated-ouvrage-types";

type SourceKind = "free_text" | "cctp_excerpt" | "internal_note";

type GeneratedOuvrageSourceFormProps = {
  existingSections: ExistingSection[];
  isGenerating: boolean;
  onGenerate: (input: {
    sourceKind: SourceKind;
    sourceText: string;
    preferredLotId: string | null;
  }) => void;
};

const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: "free_text", label: "Texte libre" },
  { value: "cctp_excerpt", label: "Extrait CCTP" },
  { value: "internal_note", label: "Note interne" },
];

export function GeneratedOuvrageSourceForm({
  existingSections,
  isGenerating,
  onGenerate,
}: GeneratedOuvrageSourceFormProps) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        onGenerate({
          sourceKind: (fd.get("sourceKind") as SourceKind) ?? "free_text",
          sourceText: (fd.get("sourceText") as string) ?? "",
          preferredLotId: (fd.get("preferredLotId") as string) || null,
        });
      }}
    >
      <div className="space-y-1.5">
        <FieldLabel htmlFor="gen-source-kind">Type de source</FieldLabel>
        <NativeSelect
          id="gen-source-kind"
          name="sourceKind"
          size="sm"
          defaultValue="free_text"
          disabled={isGenerating}
        >
          {SOURCE_KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="gen-source-text">Texte source</FieldLabel>
        <Textarea
          id="gen-source-text"
          name="sourceText"
          className="min-h-30 text-sm"
          placeholder="Collez ici le texte à analyser…"
          required
          disabled={isGenerating}
        />
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="gen-preferred-lot">Lot cible (optionnel)</FieldLabel>
        <NativeSelect
          id="gen-preferred-lot"
          name="preferredLotId"
          size="sm"
          defaultValue=""
          disabled={isGenerating}
          aria-describedby="gen-preferred-lot-hint"
        >
          <option value="">{GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL}</option>
          {existingSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.path}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription id="gen-preferred-lot-hint" className="text-xs">
          Sans lot choisi, l&apos;ouvrage sera inséré dans la section explicite{" "}
          <span className="font-medium text-foreground-secondary">À classer</span>.
        </FieldDescription>
      </div>

      <div aria-live="polite" className="text-sm text-muted-foreground">
        {isGenerating ? "Génération des ouvrages en cours…" : null}
      </div>

      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={isGenerating}
        data-testid="generated-ouvrage-generate-button"
      >
        {isGenerating ? "Génération…" : "Générer des propositions"}
      </Button>
    </form>
  );
}
