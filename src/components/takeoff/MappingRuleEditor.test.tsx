import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";

import { MappingRuleEditor } from "@/components/takeoff/MappingRuleEditor";
import type { TakeoffMappingRule } from "@/lib/takeoff/types";

const ASSEMBLIES = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Mur BA13",
    description: null,
    createdBy: null,
    createdAt: "2026-02-24T12:00:00.000Z",
    updatedAt: "2026-02-24T12:00:00.000Z",
    itemCount: 3,
  },
];

const RULE_WITH_OLD_ASSEMBLY: TakeoffMappingRule = {
  id: "99999999-9999-4999-8999-999999999999",
  tenant_id: "88888888-8888-4888-8888-888888888888",
  created_at: "2026-02-24T12:00:00.000Z",
  updated_at: "2026-02-24T12:00:00.000Z",
  created_by: null,
  name: "Appliquer ouvrage historique",
  match_pattern: "historique",
  match_type: "contains",
  priority: 30,
  is_active: true,
  action: "apply_assembly",
  action_params: {
    assembly_id: "77777777-7777-4777-8777-777777777777",
  },
};

describe("MappingRuleEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("allows saving an existing apply_assembly rule even if assembly is outside fetched list", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <MappingRuleEditor
        mode="edit"
        initialRule={RULE_WITH_OLD_ASSEMBLY}
        assemblies={ASSEMBLIES}
        onSubmit={onSubmit}
      />
    );

    expect(
      screen.getByRole("option", {
        name: `Ouvrage existant (${RULE_WITH_OLD_ASSEMBLY.action_params.assembly_id})`,
      })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer la règle" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      action: "apply_assembly",
      action_params: {
        assembly_id: RULE_WITH_OLD_ASSEMBLY.action_params.assembly_id,
      },
    });
    expect(
      screen.queryByText("L'ouvrage sélectionné est introuvable dans la liste chargée.")
    ).not.toBeInTheDocument();
  });

  // MWG « Error Link »: after a refused submit, each refused field names its reason to assistive
  // technology, and focus lands on the first one so that reason is read; a fixed field drops it.
  it("links each refused field to its reason and focuses the first one", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MappingRuleEditor mode="create" assemblies={ASSEMBLIES} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Créer la règle" }));

    const name = screen.getByLabelText("Nom de la règle");
    const pattern = screen.getByLabelText("Pattern de correspondance");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Le nom est obligatoire.");
    expect(pattern).toHaveAccessibleDescription("Le pattern est obligatoire.");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(name, "Renommage");
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(name).toHaveAccessibleDescription("");
  });
});
