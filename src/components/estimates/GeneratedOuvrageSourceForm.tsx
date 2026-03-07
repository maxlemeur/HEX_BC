"use client";

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
      <div>
        <label htmlFor="gen-source-kind" className="label text-sm font-medium">
          Type de source
        </label>
        <select
          id="gen-source-kind"
          name="sourceKind"
          className="select select-bordered select-sm w-full"
          defaultValue="free_text"
          disabled={isGenerating}
        >
          {SOURCE_KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="gen-source-text" className="label text-sm font-medium">
          Texte source
        </label>
        <textarea
          id="gen-source-text"
          name="sourceText"
          className="textarea textarea-bordered w-full min-h-[120px] text-sm"
          placeholder="Collez ici le texte a analyser..."
          required
          disabled={isGenerating}
        />
      </div>

      <div>
        <label htmlFor="gen-preferred-lot" className="label text-sm font-medium">
          Lot cible (optionnel)
        </label>
        <select
          id="gen-preferred-lot"
          name="preferredLotId"
          className="select select-bordered select-sm w-full"
          defaultValue=""
          disabled={isGenerating}
        >
          <option value="">{GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL}</option>
          {existingSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.path}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Sans lot choisi, l&apos;ouvrage sera insere dans la section explicite
          {" "}
          <span className="font-medium">A classer</span>.
        </p>
      </div>

      <div aria-live="polite" className="text-sm text-slate-500">
        {isGenerating ? "Generation des ouvrages en cours..." : null}
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={isGenerating}
        data-testid="generated-ouvrage-generate-button"
      >
        {isGenerating ? "Generation..." : "Generer des propositions"}
      </button>
    </form>
  );
}
