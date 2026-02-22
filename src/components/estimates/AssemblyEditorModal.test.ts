import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { AssemblyEditorModal, type AssemblyEditorInput } from "@/components/estimates/AssemblyEditorModal";
import type {
  EstimateAssemblyDetail,
  EstimateAssemblyItem,
} from "@/lib/estimates/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    name: overrides.name ?? "Assemblage test",
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
  it("resynchronizes form fields when initialValue changes on an open modal", async () => {
    const assemblyA = createAssemblyDetail({
      id: "assembly-a",
      name: "Assemblage A",
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
      name: "Assemblage B",
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

    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(AssemblyEditorModal, {
          key: assemblyA.id,
          isSubmitting: false,
          initialValue: assemblyA,
          onClose: () => undefined,
          onSubmit,
        })
      );
    });

    const nameInput = renderer!.root.findByProps({ id: "assembly-name" });
    const lineTitleInput = renderer!.root.findAll(
      (node) =>
        node.type === "input" &&
        typeof node.props.placeholder === "string" &&
        node.props.placeholder === "Designation"
    )[0];

    expect(nameInput.props.value).toBe("Assemblage A");
    expect(lineTitleInput.props.value).toBe("Ligne A");

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Valeur locale obsolete" } });
      lineTitleInput.props.onChange({ target: { value: "Ligne locale obsolete" } });
    });

    await act(async () => {
      renderer!.update(
        createElement(AssemblyEditorModal, {
          key: assemblyB.id,
          isSubmitting: false,
          initialValue: assemblyB,
          onClose: () => undefined,
          onSubmit,
        })
      );
    });

    const refreshedNameInput = renderer!.root.findByProps({ id: "assembly-name" });
    const refreshedDescriptionInput = renderer!.root.findByProps({
      id: "assembly-description",
    });
    const refreshedLineTitleInput = renderer!.root.findAll(
      (node) =>
        node.type === "input" &&
        typeof node.props.placeholder === "string" &&
        node.props.placeholder === "Designation"
    )[0];

    expect(refreshedNameInput.props.value).toBe("Assemblage B");
    expect(refreshedDescriptionInput.props.value).toBe("Description B");
    expect(refreshedLineTitleInput.props.value).toBe("Ligne B");

    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({
        preventDefault: () => undefined,
      });
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Assemblage B",
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
