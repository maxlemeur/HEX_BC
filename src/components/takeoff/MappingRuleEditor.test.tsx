import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MappingRuleEditor } from "@/components/takeoff/MappingRuleEditor";

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

describe("MappingRuleEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("updates preview for exact and regex match modes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <MappingRuleEditor
        mode="create"
        assemblies={ASSEMBLIES}
        onSubmit={onSubmit}
      />
    );

    await user.selectOptions(screen.getByLabelText("Type de match"), "exact");
    await user.type(screen.getByLabelText("Pattern de correspondance"), "Tube PVC");
    await user.type(screen.getByLabelText("Test designation (preview)"), "tube pvc");

    expect(screen.getByText("Correspondance detectee (exact).")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Type de match"), "regex");
    await user.clear(screen.getByLabelText("Pattern de correspondance"));
    await user.type(screen.getByLabelText("Pattern de correspondance"), "abc(");

    expect(
      screen.getByText("Regex invalide: corrigez le pattern pour activer la preview.")
    ).toBeInTheDocument();
  });

  it("validates apply_assembly and submits a valid payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <MappingRuleEditor
        mode="create"
        assemblies={ASSEMBLIES}
        defaultPriority={25}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText("Nom de la regle"), "Assemblage PVC");
    await user.type(screen.getByLabelText("Pattern de correspondance"), "pvc");
    await user.selectOptions(screen.getByLabelText("Action"), "apply_assembly");

    await user.click(screen.getByRole("button", { name: "Creer la regle" }));

    expect(screen.getByText("Selectionnez un assemblage valide.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.selectOptions(
      screen.getByLabelText("Assemblage"),
      "11111111-1111-4111-8111-111111111111"
    );
    await user.click(screen.getByRole("button", { name: "Creer la regle" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: "Assemblage PVC",
      match_pattern: "pvc",
      match_type: "contains",
      priority: 25,
      is_active: true,
      action: "apply_assembly",
      action_params: {
        assembly_id: "11111111-1111-4111-8111-111111111111",
      },
    });
  });
});
