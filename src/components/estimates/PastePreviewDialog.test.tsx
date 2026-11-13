import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PastePreviewDialog,
  type PastePreviewDialogProps,
  type PastePreviewMappingEntry,
  type PastePreviewRow,
} from "@/components/estimates/PastePreviewDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { UseVirtualListOptions } from "@/hooks/useVirtualList";

// The dialog's counts, error summary and Confirm gating cover every pasted row,
// including rows the virtualized table does not mount. The virtualizer is mocked
// to a fixed window of the first 10 rows.

const mockUseVirtualList = vi.fn();
vi.mock("@/hooks/useVirtualList", () => ({
  useVirtualList: (input: unknown) => mockUseVirtualList(input),
}));

const COLUMNS = ["Désignation", "Quantité", "Unité"];
const mapping: PastePreviewMappingEntry[] = COLUMNS.map((sourceColumn, index) => ({
  sourceColumn,
  targetField: ["designation", "quantity", "unit_code"][index],
  targetOptions: [
    { value: "designation", label: "Désignation", required: true },
    { value: "quantity", label: "Quantité" },
    { value: "unit_code", label: "Unité" },
  ],
}));

function makeRows(count: number, overrides: (index: number) => Partial<PastePreviewRow> = () => ({})): PastePreviewRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${index + 2}-${index}`,
    rowNumber: index + 2,
    include: true,
    values: { Désignation: `Ligne ${index + 2}`, Quantité: String(index + 2), Unité: "u" },
    invalidReasons: [],
    ...overrides(index),
  }));
}

function dialog(props: Partial<PastePreviewDialogProps>) {
  const all: PastePreviewDialogProps = {
    isOpen: true,
    detectedFormat: "bdc",
    mapping,
    rows: makeRows(2161),
    errors: [],
    onMappingChange: vi.fn(),
    onToggleRow: vi.fn(),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...props,
  };
  return <TooltipProvider><PastePreviewDialog {...all} /></TooltipProvider>;
}

function confirmButton() {
  return screen.getByTestId("paste-preview-dialog-confirm-button");
}

beforeEach(() => {
  mockUseVirtualList.mockReset();
  mockUseVirtualList.mockImplementation((input: UseVirtualListOptions) => {
    const isVirtualized = Boolean(input.enabled);
    return {
      scrollRef: createRef<HTMLDivElement>(),
      isVirtualized,
      virtualItems: isVirtualized
        ? Array.from({ length: 10 }, (_, index) => ({ index, key: index, start: 64 * index, size: 64, end: 64 * index + 64, lane: 0 }))
        : [],
      totalSize: isVirtualized ? 64 * input.count : 0,
      measureElement: vi.fn(),
      remeasure: vi.fn(),
      scrollToIndex: vi.fn(),
    };
  });
});

describe("PastePreviewDialog over a virtualized table", () => {
  it("gates Confirm on an included invalid row that is not mounted", () => {
    const invalid = (index: number) => index === 1500 ? { invalidReasons: ["Quantité : Nombre invalide"] } : {};
    const view = render(dialog({ rows: makeRows(2161, invalid) }));
    expect(screen.queryByLabelText("Inclure la ligne 1502")).toBeNull();
    expect(screen.getAllByTestId("paste-preview-row-include-checkbox").length).toBeLessThanOrEqual(10);
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText("1 ligne(s) invalide(s) sont encore incluses.")).toBeTruthy();
    expect(screen.getByText("1 type(s) d'erreur détecté(s) dans cet aperçu.")).toBeTruthy();

    view.rerender(dialog({ rows: makeRows(2161, (index) => index === 1500
      ? { include: false, invalidReasons: ["Quantité : Nombre invalide"] } : {}) }));
    expect(confirmButton()).toBeEnabled();
    expect(screen.getByText("Toutes les lignes incluses sont valides.")).toBeTruthy();
  });

  it("counts every row in the description", () => {
    render(dialog({ rows: makeRows(2161, (index) => index === 1500 ? { include: false } : {}) }));
    expect(screen.getAllByText("2160/2161 ligne(s) incluse(s)")).toHaveLength(1);
  });

  it("does not claim the error summary covers only the displayed rows", () => {
    render(dialog({}));
    expect(screen.getByText("Aucune erreur de validation détectée dans l'aperçu.")).toBeTruthy();
    expect(confirmButton()).toBeEnabled();
  });

  it("keeps the labour role gate and the dialog's names", () => {
    render(dialog({
      laborRole: {
        value: "",
        options: [{ value: "", label: "Choisir" }, { value: "role-1", label: "Compagnon" }],
        message: "Choisissez le rôle MO des lignes collées.",
        blocking: true,
        onChange: vi.fn(),
      },
    }));
    expect(screen.getByRole("dialog", { name: "Aperçu du collage" })).toBeTruthy();
    expect(screen.getByLabelText("Rôle MO des lignes collées")).toBeTruthy();
    expect(confirmButton()).toBeDisabled();
  });
});
