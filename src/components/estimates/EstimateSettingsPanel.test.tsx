import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EstimateSettingsPanel,
  type EstimateSettingsState,
} from "@/components/estimates/EstimateSettingsPanel";

function ControlledEstimateSettingsPanel({
  initialSettings,
}: Readonly<{
  initialSettings: EstimateSettingsState;
}>) {
  const [settings, setSettings] = useState(initialSettings);

  return (
    <EstimateSettingsPanel
      projectName="Projet test"
      versionNumber={1}
      settings={settings}
      totals={null}
      isSaving={false}
      isReadOnly={false}
      error={null}
      onChange={(patch) =>
        setSettings((currentSettings) => ({ ...currentSettings, ...patch }))
      }
      onSave={() => undefined}
    />
  );
}

const baseSettings: EstimateSettingsState = {
  title: "Version test",
  exclusions: "",
  date_devis: "2026-03-10",
  validite_jours: 30,
  currency: "EUR",
  margin_multiplier: 1,
  margin_mode: "fixed",
  margin_tiers: [],
  discount_cents: 0,
  discount_mode: "simple",
  discount_steps: [],
  global_coefficient: 1,
  tax_rate_bp: 2000,
  rounding_mode: "none",
  rounding_step_cents: 1,
};

afterEach(cleanup);

describe("EstimateSettingsPanel", () => {
  it("keeps typing stable on simple numeric inputs", async () => {
    const user = userEvent.setup();

    render(<ControlledEstimateSettingsPanel initialSettings={baseSettings} />);

    const exclusionsInput = screen.getByLabelText(
      "Précisions et exclusions particulières",
    );
    expect(
      screen.getByText(/limites propres à cette offre/i),
    ).toBeInTheDocument();
    await user.type(exclusionsInput, "Peinture hors perimetre");
    expect((exclusionsInput as HTMLTextAreaElement).value).toBe(
      "Peinture hors perimetre"
    );

    const validityInput = screen.getByLabelText("Validite (jours)");
    await user.clear(validityInput);
    await user.type(validityInput, "45");
    expect((validityInput as HTMLInputElement).value).toBe("45");

    const marginInput = screen.getByLabelText("Marge");
    await user.clear(marginInput);
    await user.type(marginInput, "1.2");
    expect((marginInput as HTMLInputElement).value).toBe("1.2");

    const discountInput = screen.getByLabelText("Remise (EUR HT)");
    await user.clear(discountInput);
    await user.type(discountInput, "12.5");
    expect((discountInput as HTMLInputElement).value).toBe("12.5");

    const taxInput = screen.getByLabelText("TVA unique");
    await user.clear(taxInput);
    await user.type(taxInput, "5.5");
    expect((taxInput as HTMLInputElement).value).toBe("5.5");
  });

  it("keeps historical successive discounts read-only when changing other settings", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <EstimateSettingsPanel
        projectName="Projet test"
        versionNumber={1}
        settings={{
          ...baseSettings,
          discount_mode: "cascade",
          discount_steps: [500],
          global_coefficient: 1.05,
        }}
        totals={null}
        isSaving={false}
        isReadOnly={false}
        error={null}
        onChange={onChange}
        onSave={() => undefined}
      />
    );

    expect(screen.getByText("Remises historiques conservées")).toBeInTheDocument();
    expect(screen.getByText(/Coefficient global : ×1.05/)).toHaveTextContent("Remises : 5 %");
    expect(screen.queryByRole("button", { name: "Cascade" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Coefficient global")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Etape 1 (%)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remise (EUR HT)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Marge par tranche" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ margin_mode: "tiered" });
  });

  it("offers only a simple discount on new estimates and explains non-progressive margin tiers", async () => {
    const user = userEvent.setup();
    render(<ControlledEstimateSettingsPanel initialSettings={baseSettings} />);
    expect(screen.queryByRole("button", { name: "Cascade" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remise (EUR HT)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Marge par tranche" }));
    expect(screen.getByText(/Le coût total HT des lignes/)).toHaveTextContent("n’est pas découpé en tranches progressives");
    expect(screen.getByText(/Au passage d’un seuil/)).toBeInTheDocument();
    expect(screen.getByText(/Barème par défaut/)).toBeInTheDocument();
  });

  it("requires an explicit eligible-work choice for reverse charge", async () => {
    const user = userEvent.setup();
    render(<ControlledEstimateSettingsPanel initialSettings={baseSettings} />);

    await user.selectOptions(
      screen.getByLabelText("Régime de TVA"),
      "subcontractor"
    );

    expect(
      screen.getByRole("option", {
        name: /travaux immobiliers sous-traités éligibles/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/À sélectionner uniquement pour une sous-traitance/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ne relèvent pas automatiquement de ce régime/i)
    ).toBeInTheDocument();
  });
});
