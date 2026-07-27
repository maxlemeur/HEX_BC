import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

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

  it("keeps typing stable on cascade numeric inputs", async () => {
    const user = userEvent.setup();

    render(
      <ControlledEstimateSettingsPanel
        initialSettings={{
          ...baseSettings,
          discount_mode: "cascade",
          discount_steps: [500],
          global_coefficient: 1.05,
        }}
      />
    );

    const globalCoefficientInput = screen.getByLabelText("Coefficient global");
    await user.clear(globalCoefficientInput);
    await user.type(globalCoefficientInput, "1.2");
    expect((globalCoefficientInput as HTMLInputElement).value).toBe("1.2");

    const stepInput = screen.getByLabelText("Etape 1 (%)");
    await user.clear(stepInput);
    await user.type(stepInput, "7.5");
    expect((stepInput as HTMLInputElement).value).toBe("7.5");
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
