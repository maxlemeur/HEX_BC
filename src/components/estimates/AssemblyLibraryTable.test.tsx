import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { AssemblyLibraryTable } from "@/components/estimates/AssemblyLibraryTable";
import type {
  EstimateAssemblyDetail,
  EstimateAssemblyItem,
  EstimateAssemblySummary,
} from "@/lib/estimates/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createAssemblyItem(
  overrides: Partial<EstimateAssemblyItem> = {},
): EstimateAssemblyItem {
  return {
    id: overrides.id ?? "item-test",
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

function createAssemblySummary(): EstimateAssemblySummary {
  return {
    id: "assembly-test",
    name: "Faux plafond",
    description: "Ouvrage compose genere depuis un test",
    createdBy: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    itemCount: 2,
  };
}

function createAssemblyDetail(
  summary: EstimateAssemblySummary,
): EstimateAssemblyDetail {
  return {
    ...summary,
    items: [
      createAssemblyItem({
        id: "item-2",
        title: "Materiel de pose - Pose de plaques",
        unit: "m²",
        k_fo: 1.1,
        k_mo: 1.2,
        default_quantity: 12,
        position: 2,
      }),
      createAssemblyItem({
        id: "item-1",
        title: "Main d'oeuvre - Ossature métallique",
        unit: "ml",
        k_fo: 1,
        k_mo: 1.05,
        default_quantity: 10,
        position: 1,
      }),
    ],
  };
}

describe("AssemblyLibraryTable", () => {
  it("charge et conserve le contenu affiché dans la ligne dépliée", async () => {
    const assembly = createAssemblySummary();
    const loadAssembly =
      vi.fn<(assemblyId: string) => Promise<EstimateAssemblyDetail>>();
    loadAssembly.mockResolvedValue(createAssemblyDetail(assembly));

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(AssemblyLibraryTable, {
          assemblies: [assembly],
          busyAssemblyId: null,
          onEdit: vi.fn(),
          onRename: vi.fn(),
          onDuplicate: vi.fn(),
          onDelete: vi.fn(),
          loadAssembly,
        }),
      );
    });

    const getToggle = () =>
      renderer!.root.findByProps({
        "aria-controls": "assembly-preview-assembly-test",
      });

    expect(getToggle().props["aria-expanded"]).toBe(false);

    await act(async () => {
      getToggle().props.onClick();
      await Promise.resolve();
    });

    const renderedContent = JSON.stringify(renderer!.toJSON());
    expect(loadAssembly).toHaveBeenCalledOnce();
    expect(loadAssembly).toHaveBeenCalledWith("assembly-test");
    expect(renderedContent).toContain("Ouvrage composé généré depuis un test");
    expect(renderedContent).toContain("Main-d’œuvre – Ossature métallique");
    expect(renderedContent).toContain("Matériel de pose – Pose de plaques");
    expect(renderedContent.indexOf("Main-d’œuvre")).toBeLessThan(
      renderedContent.indexOf("Matériel de pose"),
    );
    expect(renderedContent).not.toContain("ligne(s)");

    await act(async () => {
      getToggle().props.onClick();
    });
    expect(getToggle().props["aria-expanded"]).toBe(false);

    await act(async () => {
      getToggle().props.onClick();
    });

    expect(getToggle().props["aria-expanded"]).toBe(true);
    expect(loadAssembly).toHaveBeenCalledOnce();
  });
});
