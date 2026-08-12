import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@/components/estimates/SendEstimateModal", () => ({
  SendEstimateModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Modal envoi</div> : null,
}));

import { EstimateStatusActions } from "@/components/estimates/EstimateStatusActions";

const UPDATED_AT = "2026-03-06T09:00:00.000Z";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockRefresh.mockReset();
});

describe("EstimateStatusActions", () => {
  it("propose de reprendre un statut sending sans transition manuelle", async () => {
    render(
      <EstimateStatusActions
        versionId="v1"
        currentStatus="sending"
        updatedAt={UPDATED_AT}
      />
    );

    const resumeButton = screen.getByRole("button", {
      name: /Reprendre l.envoi/i,
    });
    expect(
      screen.queryByRole("button", { name: /Marquer|Archiver/i })
    ).not.toBeInTheDocument();

    await userEvent.click(resumeButton);

    expect(screen.getByRole("dialog")).toHaveTextContent("Modal envoi");
  });

  it("utilise le vrai updated_at en If-Match et ne force pas le gating", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EstimateStatusActions
        versionId="v1"
        currentStatus="sent"
        updatedAt={UPDATED_AT}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Marquer accepté/i })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/estimates/v1/status");
    const headers = init.headers as Record<string, string>;
    expect(headers["If-Match"]).toBe(UPDATED_AT);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ status: "accepted" });
    expect(body).not.toHaveProperty("force");
  });

  it("affiche un message explicite quand le gating bloque l'envoi", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "ESTIMATE_GATING_BLOCKED", message: "blocked" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EstimateStatusActions
        versionId="v1"
        currentStatus="draft"
        updatedAt={UPDATED_AT}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Marquer envoyé/i })
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/Envoi bloqué/i);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
