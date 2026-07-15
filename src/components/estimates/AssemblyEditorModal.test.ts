import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssemblyEditorModal, type AssemblyEditorInput } from "@/components/estimates/AssemblyEditorModal";
import type {
  EstimateAssemblyDetail,
  EstimateAssemblyItem,
} from "@/lib/estimates/client";

function createAssemblyItem(overrides: Partial<EstimateAssemblyItem> = {}): EstimateAssemblyItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    tenant_id: "tenant-test",
    assembly_id: overrides.assembly_id ?? "assembly-test",
    title: overrides.title ?? "Ligne test",
    unit: overrides.unit ?? "u",
    k_fo: overrides.k_fo ?? 1,
    k_mo: overrides.k_mo ?? 1,
    labor_role_id: overrides.labor_role_id ?? null,
    default_quantity: overrides.default_quantity ?? 1,
    position: overrides.position ?? 1,
    ...overrides,
    h_mo: overrides.h_mo ?? 0,
    supply_type_id: overrides.supply_type_id ?? null,
    cost_type: overrides.cost_type ?? "material",
    unit_cost_ht_cents: overrides.unit_cost_ht_cents ?? 0,
    loss_coeff_bp: overrides.loss_coeff_bp ?? 0,
    yield_value: overrides.yield_value ?? null,
    yield_unit: overrides.yield_unit ?? null,
    source_metadata: overrides.source_metadata ?? {},
  };
}

function createAssemblyDetail(
  overrides: Partial<EstimateAssemblyDetail> = {}
): EstimateAssemblyDetail {
  const id = overrides.id ?? crypto.randomUUID();
  const items =
    overrides.items ??
    [
      createAssemblyItem({
        assembly_id: id,
      }),
    ];

  return {
    id,
    name: overrides.name ?? "Ouvrage test",
    description: overrides.description ?? "Description test",
    createdBy: overrides.createdBy ?? null,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    itemCount: overrides.itemCount ?? items.length,
    items,
    ...overrides,
  };
}

describe("AssemblyEditorModal", () => {
  afterEach(cleanup);

  it("resynchronizes form fields when initialValue changes on an open modal", async () => {
    const assemblyA = createAssemblyDetail({
      id: "assembly-a",
      name: "Ouvrage A",
      description: "Description A",
      items: [
        createAssemblyItem({
          id: "item-a",
          assembly_id: "assembly-a",
          title: "Ligne A",
          unit: "ml",
          k_fo: 1.1,
          k_mo: 1.2,
          default_quantity: 2,
          position: 1,
        }),
      ],
    });

    const assemblyB = createAssemblyDetail({
      id: "assembly-b",
      name: "Ouvrage B",
      description: "Description B",
      items: [
        createAssemblyItem({
          id: "item-b",
          assembly_id: "assembly-b",
          title: "Ligne B",
          unit: "m2",
          k_fo: 2.2,
          k_mo: 2.3,
          default_quantity: 4,
          position: 1,
        }),
      ],
    });

    const onSubmit = vi.fn<(input: AssemblyEditorInput) => Promise<void>>();
    onSubmit.mockResolvedValue(undefined);

    const renderResult = render(
      createElement(AssemblyEditorModal, {
        key: assemblyA.id,
        isSubmitting: false,
        initialValue: assemblyA,
        onClose: () => undefined,
        onSubmit,
      })
    );

    const nameInput = document.getElementById("assembly-name") as HTMLInputElement;
    const lineTitleInput = screen.getByPlaceholderText("Désignation");

    expect(nameInput).toHaveValue("Ouvrage A");
    expect(lineTitleInput).toHaveValue("Ligne A");

    fireEvent.change(nameInput, { target: { value: "Valeur locale obsolete" } });
    fireEvent.change(lineTitleInput, { target: { value: "Ligne locale obsolete" } });

    renderResult.rerender(
      createElement(AssemblyEditorModal, {
        key: assemblyB.id,
        isSubmitting: false,
        initialValue: assemblyB,
        onClose: () => undefined,
        onSubmit,
      })
    );

    const refreshedNameInput = document.getElementById("assembly-name") as HTMLInputElement;
    const refreshedDescriptionInput = document.getElementById(
      "assembly-description"
    ) as HTMLTextAreaElement;
    const refreshedLineTitleInput = screen.getByPlaceholderText("Désignation");

    expect(refreshedNameInput).toHaveValue("Ouvrage B");
    expect(refreshedDescriptionInput).toHaveValue("Description B");
    expect(refreshedLineTitleInput).toHaveValue("Ligne B");

    fireEvent.submit(refreshedNameInput.closest("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ouvrage B",
      description: "Description B",
      items: [
        {
          title: "Ligne B",
          unit: "m2",
          kFo: 2.2,
          kMo: 2.3,
          laborRoleId: null,
          defaultQuantity: 4,
          position: 1,
        },
      ],
    });
  });
});
