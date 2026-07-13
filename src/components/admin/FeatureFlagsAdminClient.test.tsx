import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutateMock, swrMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  swrMock: vi.fn(),
}));

vi.mock("swr", () => ({ default: swrMock }));

import { FeatureFlagsAdminClient } from "@/app/dashboard/admin/flags/FeatureFlagsAdminClient";

const FLAGS = [
  {
    tenant_id: "tenant-1",
    flag_key: "ESTIMATE_GATING_BLOCKING_FLAGS",
    enabled: true,
    value: "missing_price",
  },
  {
    tenant_id: "tenant-1",
    flag_key: "STALE_PRICE_DAYS",
    enabled: false,
    value: "90",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mutateMock.mockResolvedValue(undefined);
  swrMock.mockReturnValue({
    data: { tenant_id: "tenant-1", flags: FLAGS },
    error: null,
    isLoading: false,
    isValidating: false,
    mutate: mutateMock,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FeatureFlagsAdminClient", () => {
  it("uses a distinct cache key for the complete administrator list", () => {
    render(<FeatureFlagsAdminClient tenantId="tenant-1" />);

    expect(swrMock).toHaveBeenCalledWith(
      ["/api/feature-flags", "tenant-1", "include-inactive"],
      expect.any(Function)
    );
  });

  it("does not save a value draft when toggling a functionality", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          flag: { ...FLAGS[0], enabled: false },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeatureFlagsAdminClient tenantId="tenant-1" />);

    const valueInputs = screen.getAllByRole("textbox", {
      name: "Valeur de ESTIMATE_GATING_BLOCKING_FLAGS",
    });
    fireEvent.change(valueInputs[0], { target: { value: "missing_quantity" } });
    expect(screen.getByText(/1 modification non enregistrée/)).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Désactiver ESTIMATE_GATING_BLOCKING_FLAGS",
      })[0]
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      tenant_id: "tenant-1",
      flag_key: "ESTIMATE_GATING_BLOCKING_FLAGS",
      enabled: false,
    });
    expect(valueInputs[0]).toHaveValue("missing_quantity");
  });

  it("disables value saving until a draft differs, then sends only the explicit save", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          flag: { ...FLAGS[1], value: "120" },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeatureFlagsAdminClient tenantId="tenant-1" />);

    const saveButtons = screen.getAllByRole("button", {
      name: "Enregistrer la valeur de STALE_PRICE_DAYS",
    });
    expect(saveButtons[0]).toBeDisabled();

    fireEvent.change(
      screen.getAllByRole("textbox", { name: "Valeur de STALE_PRICE_DAYS" })[0],
      { target: { value: "120" } }
    );
    expect(saveButtons[0]).toBeEnabled();
    fireEvent.click(saveButtons[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      tenant_id: "tenant-1",
      flag_key: "STALE_PRICE_DAYS",
      enabled: false,
      value: "120",
    });
  });

  it("filters by state and uses cards on mobile with a bounded desktop table", () => {
    render(<FeatureFlagsAdminClient tenantId="tenant-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Inactifs" }));

    expect(screen.getByText("1 résultat")).toBeInTheDocument();
    expect(screen.getAllByText("STALE_PRICE_DAYS")).toHaveLength(2);
    expect(screen.queryByText("ESTIMATE_GATING_BLOCKING_FLAGS")).not.toBeInTheDocument();
    expect(screen.getAllByText("STALE_PRICE_DAYS")[0]).toHaveClass(
      "[overflow-wrap:anywhere]"
    );
    expect(screen.getByRole("table")).toHaveClass("table-fixed");
  });

  it("keeps draft values when the list is refreshed", () => {
    render(<FeatureFlagsAdminClient tenantId="tenant-1" />);

    const input = screen.getAllByRole("textbox", {
      name: "Valeur de STALE_PRICE_DAYS",
    })[0];
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));

    expect(mutateMock).toHaveBeenCalled();
    expect(input).toHaveValue("120");
    expect(screen.getByText(/brouillons sont conservés/)).toBeInTheDocument();
  });
});
