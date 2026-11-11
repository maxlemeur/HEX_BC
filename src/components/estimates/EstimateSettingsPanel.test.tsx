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
  reservedLineTitles,
  isReadOnly = false,
}: Readonly<{
  initialSettings: EstimateSettingsState;
  reservedLineTitles?: readonly string[];
  isReadOnly?: boolean;
}>) {
  const [settings, setSettings] = useState(initialSettings);

  return (
    <EstimateSettingsPanel
      projectName="Projet test"
      versionNumber={1}
      settings={settings}
      totals={null}
      isSaving={false}
      isReadOnly={isReadOnly}
      error={null}
      onChange={(patch) =>
        setSettings((currentSettings) => ({ ...currentSettings, ...patch }))
      }
      onSave={() => undefined}
      reservedLineTitles={reservedLineTitles}
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

    const validityInput = screen.getByLabelText("Validité (jours)");
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

  // TI-682, lot C, PR 4 (D28): an offer that reserves lines says so in its limits text; the paragraph is inserted after
  // what is already written, and stays editable.
  it("inserts the paragraph listing the reserved lines into the limits text, editable", async () => {
    const user = userEvent.setup();
    render(<ControlledEstimateSettingsPanel initialSettings={{ ...baseSettings, exclusions: "Nettoyage exclu." }}
      reservedLineTitles={["Réseau enterré", "Calorifuge"]} />);
    await user.click(screen.getByRole("button", { name: "Insérer les réserves dans les précisions" }));
    const limits = screen.getByRole("textbox", { name: "Précisions et exclusions particulières" });
    expect(limits).toHaveValue("Nettoyage exclu.\n\nLes prestations suivantes ne sont pas chiffrées dans la présente offre :"
      + "\n- Réseau enterré\n- Calorifuge");
    await user.type(limits, " (à confirmer)");
    expect((limits as HTMLTextAreaElement).value.endsWith("Calorifuge (à confirmer)")).toBe(true);
  });

  it("offers no insertion without a reserved line, nor read-only", () => {
    render(<ControlledEstimateSettingsPanel initialSettings={baseSettings} reservedLineTitles={[]} />);
    expect(screen.queryByRole("button", { name: "Insérer les réserves dans les précisions" })).not.toBeInTheDocument();
    cleanup();
    render(<ControlledEstimateSettingsPanel initialSettings={baseSettings} reservedLineTitles={["Réseau enterré"]} isReadOnly />);
    expect(screen.queryByRole("button", { name: "Insérer les réserves dans les précisions" })).not.toBeInTheDocument();
  });
});
