import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { EstimateEditorDrawer } from "./EstimateEditorDrawer";

vi.mock("@/components/estimates/EstimateSettingsPanel", () => ({ EstimateSettingsPanel: () => null }));
vi.mock("@/components/estimates/EstimateEventsTimeline", () => ({ EstimateEventsTimeline: () => null }));
vi.mock("@/components/estimates/EstimateSuggestionRulesManager", () => ({ EstimateSuggestionRulesManager: () => null }));
vi.mock("@/components/estimates/LaborRolesManager", () => ({ LaborRolesManager: () => null }));
vi.mock("@/components/estimates/MarginTiersManager", () => ({ MarginTiersManager: () => null }));
afterEach(cleanup);
function setup(overrides = {}) {
  const props = {
    isOpen: true, settings: {}, auditLogs: [], hasUnsavedSettings: true,
    onClose: vi.fn(), onDiscardSettings: vi.fn(), onSaveBeforeClose: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as ComponentProps<typeof EstimateEditorDrawer>;
  render(<EstimateEditorDrawer {...props} />);
  return props;
}
describe("settings drawer close confirmation", () => {
  it.each(["button", "backdrop", "escape"])("asks before closing via %s", (source) => {
    const props = setup();
    if (source === "button") fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    if (source === "backdrop") fireEvent.click(screen.getByTestId("estimate-editor-drawer-backdrop"));
    if (source === "escape") fireEvent.keyDown(screen.getByTestId("estimate-editor-drawer"), { key: "Escape" });
    expect(screen.getByText("Enregistrer les modifications du paramétrage ?")).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Continuer à modifier"));
    expect(props.onDiscardSettings).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it.each([true, false])("closes only after successful save (%s)", async (success) => {
    const props = setup({ onSaveBeforeClose: vi.fn().mockResolvedValue(success) });
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(props.onSaveBeforeClose).toHaveBeenCalledOnce());
    if (success) await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    else {
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(props.onClose).not.toHaveBeenCalled();
    }
  });
});
