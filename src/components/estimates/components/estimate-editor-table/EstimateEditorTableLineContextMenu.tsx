"use client";

import { type FocusEvent, type KeyboardEvent, useEffect, useState } from "react";

import { normalizeAidInput } from "@/components/estimates/components/estimate-editor-row/shared";
import { useEstimateV3Grid } from "@/components/estimates/v3/V3LineCells";
import { ESTIMATE_V3_ITEM_CONVERSION_REASON } from "@/lib/estimates/v3-editor";

type EstimateEditorTableLineContextMenuProps = {
  itemId: string;
  aid: string | null;
  x: number;
  y: number;
  isReadOnly: boolean;
  isViewerMode: boolean;
  isItemConversionPending: boolean;
  hasAssociatedProduct: boolean;
  onPatchAid: (
    itemId: string,
    aid: string | null,
    options: { persist: boolean },
  ) => void;
  onCompareSuppliers: (itemId: string) => void;
  onOpenArticle: (itemId: string) => void;
  onAssociateArticle: (itemId: string) => void;
  onConvertToSection: (itemId: string) => void;
};

export function EstimateEditorTableLineContextMenu({
  itemId,
  aid,
  x,
  y,
  isReadOnly,
  isViewerMode,
  isItemConversionPending,
  hasAssociatedProduct,
  onPatchAid,
  onCompareSuppliers,
  onOpenArticle,
  onAssociateArticle,
  onConvertToSection,
}: EstimateEditorTableLineContextMenuProps) {
  // Sous-lot 2.8b (A8, D-b) : pas de conversion ligne ↔ section sur une v3, motif nommé.
  const isV3 = useEstimateV3Grid() !== null;
  const [aidDraft, setAidDraft] = useState(aid ?? "");

  useEffect(() => {
    setAidDraft(aid ?? "");
  }, [aid, itemId]);

  const handleAidKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  const handleAidBlur = (event: FocusEvent<HTMLInputElement>) => {
    const normalizedAid = normalizeAidInput(event.target.value);
    setAidDraft(normalizedAid ?? "");
    onPatchAid(itemId, normalizedAid, { persist: true });
  };

  return (
    <div
      className="estimate-supplier-comparison-context-menu estimate-line-context-menu"
      role="menu"
      aria-label="Actions de la ligne"
      data-testid="estimate-line-context-menu"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <label className="estimate-line-context-menu__field">
        <span className="estimate-line-context-menu__label">AID</span>
        <input
          autoFocus
          className="estimate-line-context-menu__input"
          value={aidDraft}
          disabled={isReadOnly}
          placeholder="Ex. CU.TU.100"
          aria-label="Identifiant AID de la ligne"
          onChange={(event) => {
            const nextAid = event.target.value;
            setAidDraft(nextAid);
            onPatchAid(itemId, nextAid, { persist: false });
          }}
          onBlur={handleAidBlur}
          onKeyDown={handleAidKeyDown}
        />
      </label>

      <div className="estimate-line-context-menu__separator" />

      <button
        type="button"
        className="estimate-supplier-comparison-context-menu__action"
        role="menuitem"
        onClick={() => onOpenArticle(itemId)}
        disabled={!hasAssociatedProduct}
      >
        Fiche article
      </button>
      <button
        type="button"
        className="estimate-supplier-comparison-context-menu__action"
        role="menuitem"
        onClick={() => onAssociateArticle(itemId)}
        disabled={isReadOnly}
      >
        Associer ou remplacer l’article
      </button>
      <button
        type="button"
        className="estimate-supplier-comparison-context-menu__action"
        role="menuitem"
        onClick={() => onCompareSuppliers(itemId)}
        disabled={isItemConversionPending}
      >
        Comparer les fournisseurs
      </button>
      {!isViewerMode ? (
        <>
          <div className="estimate-line-context-menu__separator" />
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={() => onConvertToSection(itemId)}
            disabled={isReadOnly || isItemConversionPending || isV3}
            title={isV3 ? ESTIMATE_V3_ITEM_CONVERSION_REASON : undefined}
          >
            Convertir en section
            {isV3 ? (
              <span className="block text-xs font-normal">{ESTIMATE_V3_ITEM_CONVERSION_REASON}</span>
            ) : null}
          </button>
        </>
      ) : null}
    </div>
  );
}
