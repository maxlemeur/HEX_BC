import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (children: ReactNode) => children };
});

const { createEstimateTemplateMock } = vi.hoisted(() => ({
  createEstimateTemplateMock: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  createEstimateTemplate: createEstimateTemplateMock,
}));

import { SaveAsTemplateButton } from "@/components/estimates/SaveAsTemplateButton";

describe("SaveAsTemplateButton", () => {
  afterEach(cleanup);

  beforeEach(() => {
    createEstimateTemplateMock.mockReset();
  });

  it("shows success toast after successful save", async () => {
    createEstimateTemplateMock.mockResolvedValue(undefined);

    render(
      createElement(
        ToastProvider,
        null,
        createElement(SaveAsTemplateButton, { versionId: "version-1" })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Sauvegarder comme modele" }));

    const nameInput = document.getElementById("template-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Template test" } });
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() =>
      expect(createEstimateTemplateMock).toHaveBeenCalledWith({
        sourceVersionId: "version-1",
        name: "Template test",
        description: null,
      })
    );

    expect(createEstimateTemplateMock).toHaveBeenCalledWith({
      sourceVersionId: "version-1",
      name: "Template test",
      description: null,
    });

    expect(await screen.findByText("Template enregistre")).toBeInTheDocument();
  });

  it("shows error toast when save fails", async () => {
    createEstimateTemplateMock.mockRejectedValue(new Error("Boom"));

    render(
      createElement(
        ToastProvider,
        null,
        createElement(SaveAsTemplateButton, { versionId: "version-1" })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Sauvegarder comme modele" }));

    const nameInput = document.getElementById("template-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Template test" } });
    fireEvent.submit(nameInput.closest("form")!);

    expect(await screen.findByText("Enregistrement impossible")).toBeInTheDocument();
  });
});
