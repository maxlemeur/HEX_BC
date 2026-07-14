import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AssemblyEditorDialog,
  type AssemblyEditorInput,
} from "@/components/estimates/AssemblyEditorDialog";
import type { EstimateAssemblyDetail } from "@/lib/estimates/client";

const LABOR_ROLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLY_TYPE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SUPPLY_TYPES = [
  {
    id: SUPPLY_TYPE_ID,
    tenant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    code: "TUBE",
    name: "Tube",
    created_at: "2026-07-14T08:00:00.000Z",
    updated_at: "2026-07-14T08:00:00.000Z",
  },
];

const ASSEMBLY: EstimateAssemblyDetail = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Pose de cloison",
  description: "Assemblage avec main-d’œuvre",
  referenceCode: "ASM-CLOISON",
  unit: "m²",
  pricingSource: "manual",
  directCostCents: 9000,
  targetPriceCents: 0,
  averageOutputRate: null,
  averageTimeHours: 2,
  sourceMetadata: {},
  createdBy: null,
  createdAt: "2026-07-14T08:00:00.000Z",
  updatedAt: "2026-07-14T08:00:00.000Z",
  itemCount: 1,
  items: [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      tenant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      assembly_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Compagnon plaquiste",
      unit: "h",
      k_fo: 0,
      k_mo: 1,
      labor_role_id: LABOR_ROLE_ID,
      supply_type_id: null,
      default_quantity: 1,
      h_mo: 2,
      position: 1,
      cost_type: "labor",
      unit_cost_ht_cents: 4500,
      loss_coeff_bp: 0,
      yield_value: null,
      yield_unit: null,
      source_metadata: {},
      created_at: "2026-07-14T08:00:00.000Z",
      updated_at: "2026-07-14T08:00:00.000Z",
    },
  ],
};

describe("AssemblyEditorDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses the shared modal layer and exposes price, labor time and named roles", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(input: AssemblyEditorInput) => Promise<void>>();
    onSubmit.mockResolvedValue(undefined);

    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={ASSEMBLY}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[
          {
            id: LABOR_ROLE_ID,
            tenant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            name: "Compagnon",
            hourly_rate_cents: 4500,
            is_active: true,
            position: 1,
            created_at: "2026-07-14T08:00:00.000Z",
            updated_at: "2026-07-14T08:00:00.000Z",
          },
        ]}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Modifier l'assemblage" });
    expect(dialog.closest("[data-ui-modal-root]")).not.toBeNull();
    expect(dialog.parentElement?.parentElement).toHaveClass("z-[100]");
    expect(screen.queryByText(/Rôle MO \(UUID\)/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Temps MO (h)")).toHaveValue(2);
    expect(screen.getByLabelText("Prix de revient FO (€)")).toHaveValue(45);
    expect(
      screen.getByRole("option", { name: /Compagnon.*45,00.*€\/h/ })
    ).toBeInTheDocument();
    const laborRoleSelect = screen.getByLabelText("Rôle de main-d’œuvre");
    expect(laborRoleSelect).toHaveAttribute(
      "title",
      "L’identifiant technique est géré automatiquement."
    );
    expect(screen.queryByText(/identifiant technique/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Pose de cloison",
      description: "Assemblage avec main-d’œuvre",
      referenceCode: "ASM-CLOISON",
      unit: "m²",
      items: [
        expect.objectContaining({
          title: "Compagnon plaquiste",
          costType: "labor",
          laborRoleId: LABOR_ROLE_ID,
          defaultQuantity: 1,
          laborHours: 2,
          unitCostHtCents: 4500,
        }),
      ],
    });
  });

  it("searches the catalogue from a designation and applies the selected article", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          items: [
            {
              id: "catalogue-inox",
              reference: "INOX-50",
              designation: "Tube inox DN50",
              unit: "ml",
              unit_price_cents: 1234,
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={null}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[]}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />
    );

    const designationInput = screen.getByLabelText("Désignation *");
    expect(designationInput).toHaveAttribute(
      "placeholder",
      "Rechercher une désignation"
    );
    expect(designationInput).toHaveAttribute(
      "list",
      "assembly-item-0-title-input-catalogue-list"
    );

    await user.type(designationInput, "inox");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/catalogue?search=inox&limit=8",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    await waitFor(() =>
      expect(
        document.querySelector('option[value="Tube inox DN50"]')
      ).not.toBeNull()
    );

    fireEvent.change(designationInput, {
      target: { value: "Tube inox DN50" },
    });

    expect(screen.getByLabelText("Unité")).toHaveValue("ml");
    expect(screen.getByLabelText("Prix de revient FO (€)")).toHaveValue(12.34);
  });

  it("separates quantity from labor time and uses coefficients instead of losses", async () => {
    const user = userEvent.setup();
    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={{
          ...ASSEMBLY,
          items: [
            {
              ...ASSEMBLY.items[0],
              k_mo: 1.5,
              loss_coeff_bp: 5000,
            },
          ],
        }}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[]}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />
    );

    const header = screen.getByTestId("assembly-items-header");
    expect(header).toHaveTextContent("Qté");
    expect(header).toHaveTextContent("PR FO");
    expect(header).toHaveTextContent("Type FO");
    expect(header).toHaveTextContent("K FO");
    expect(header).toHaveTextContent("H MO");
    expect(header).toHaveTextContent("Rôle MO");
    expect(header).toHaveTextContent("K MO");
    expect(header).toHaveTextContent("Total");
    expect(header).not.toHaveTextContent("PU HT");
    expect(header).not.toHaveTextContent("Coût HT");
    expect(header).not.toHaveTextContent("Pertes");
    expect(within(header).getByText("PR FO")).toHaveClass("bg-blue-100/80");
    expect(within(header).getByText("Type FO")).toHaveClass("bg-blue-100/80");
    expect(within(header).getByText("K FO")).toHaveClass("bg-blue-100/80");
    expect(within(header).getByText("H MO")).toHaveClass("bg-amber-100/80");
    expect(within(header).getByText("Rôle MO")).toHaveClass("bg-amber-100/80");
    expect(within(header).getByText("K MO")).toHaveClass("bg-amber-100/80");
    expect(screen.getByLabelText("Prix de revient FO (€)")).toHaveClass(
      "!bg-blue-50/80"
    );
    expect(screen.getByLabelText("Coefficient FO")).toHaveClass(
      "!bg-blue-50/80"
    );
    expect(screen.getByLabelText("Temps MO (h)")).toHaveClass(
      "!bg-amber-50/80"
    );
    expect(screen.getByLabelText("Rôle de main-d’œuvre")).toHaveClass(
      "!bg-amber-50/80"
    );
    expect(screen.getByLabelText("Coefficient MO")).toHaveClass(
      "!bg-amber-50/80"
    );
    expect(screen.getByLabelText("Quantité par défaut")).toHaveValue(1);
    expect(screen.getByLabelText("Temps MO (h)")).toHaveValue(2);
    expect(screen.queryByLabelText("Pertes (%)")).not.toBeInTheDocument();
    expect(screen.getAllByText(/135,00/)).toHaveLength(2);

    await user.clear(screen.getByLabelText("Coefficient MO"));
    await user.type(screen.getByLabelText("Coefficient MO"), "2");
    expect(screen.getAllByText(/180,00/)).toHaveLength(2);
  });

  it("allows a supply line to select a labor role and enter labor time", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(input: AssemblyEditorInput) => Promise<void>>();
    onSubmit.mockResolvedValue(undefined);

    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={null}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[
          {
            id: LABOR_ROLE_ID,
            tenant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            name: "Compagnon",
            hourly_rate_cents: 4500,
            is_active: true,
            position: 1,
            created_at: "2026-07-14T08:00:00.000Z",
            updated_at: "2026-07-14T08:00:00.000Z",
          },
        ]}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText("Nom de l'assemblage *"), "Kit inox");
    await user.type(screen.getByLabelText("Désignation *"), "Tube inox");
    const laborRoleSelect = screen.getByLabelText("Rôle de main-d’œuvre");
    expect(laborRoleSelect).toBeEnabled();
    await user.selectOptions(laborRoleSelect, LABOR_ROLE_ID);
    await user.selectOptions(screen.getByLabelText("Type FO"), SUPPLY_TYPE_ID);
    await user.clear(screen.getByLabelText("Temps MO (h)"));
    await user.type(screen.getByLabelText("Temps MO (h)"), "1.5");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            costType: "material",
            laborRoleId: LABOR_ROLE_ID,
            supplyTypeId: SUPPLY_TYPE_ID,
            laborHours: 1.5,
          }),
        ],
      })
    );
  });
  it("renders compact rows and derives positions from their visual order", async () => {
    const fiveLineAssembly: EstimateAssemblyDetail = {
      ...ASSEMBLY,
      itemCount: 5,
      items: Array.from({ length: 5 }, (_, index) => ({
        ...ASSEMBLY.items[0],
        id: `component-${index + 1}`,
        title: `Composant ${index + 1}`,
        position: (index + 1) * 10,
      })),
    };

    const user = userEvent.setup();
    const onSubmit = vi.fn<(input: AssemblyEditorInput) => Promise<void>>();
    onSubmit.mockResolvedValue(undefined);

    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={fiveLineAssembly}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[]}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByTestId("assembly-items-grid")).toHaveClass(
      "overflow-x-auto"
    );
    expect(screen.getByTestId("assembly-items-header")).toHaveClass(
      "lg:grid",
      "min-w-[1100px]",
      "gap-0"
    );
    const rows = screen.getAllByTestId("assembly-item-row");
    expect(rows).toHaveLength(5);
    rows.forEach((row) =>
      expect(row).toHaveClass("lg:p-0", "lg:gap-0", "lg:min-w-[1100px]")
    );
    expect(screen.getAllByLabelText("Quantité par défaut")[0]).toHaveClass(
      "text-right",
      "tabular-nums",
      "[appearance:textfield]"
    );
    expect(screen.getByTestId("assembly-items-header")).not.toHaveTextContent(
      "Pos."
    );
    expect(screen.queryByLabelText("Position")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(
      onSubmit.mock.calls[0][0].items.map((item) => item.position)
    ).toEqual([1, 2, 3, 4, 5]);
  });
});
