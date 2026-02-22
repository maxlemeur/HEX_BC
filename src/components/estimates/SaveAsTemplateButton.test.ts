import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";

const { createEstimateTemplateMock } = vi.hoisted(() => ({
  createEstimateTemplateMock: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  createEstimateTemplate: createEstimateTemplateMock,
}));

import { SaveAsTemplateButton } from "@/components/estimates/SaveAsTemplateButton";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SaveAsTemplateButton", () => {
  beforeEach(() => {
    createEstimateTemplateMock.mockReset();
  });

  it("shows success toast after successful save", async () => {
    createEstimateTemplateMock.mockResolvedValue(undefined);

    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(
          ToastProvider,
          null,
          createElement(SaveAsTemplateButton, { versionId: "version-1" })
        )
      );
    });

    const openButton = renderer!.root.findAllByType("button")[0];

    await act(async () => {
      openButton.props.onClick();
    });

    const nameInput = renderer!.root.findByProps({ id: "template-name" });

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Template test" } });
    });

    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: () => undefined });
    });

    expect(createEstimateTemplateMock).toHaveBeenCalledWith({
      sourceVersionId: "version-1",
      name: "Template test",
      description: null,
    });

    const successToast = renderer!.root.findAll(
      (node) => node.type === "p" && node.children.join("") === "Template enregistre"
    );
    expect(successToast).toHaveLength(1);
  });

  it("shows error toast when save fails", async () => {
    createEstimateTemplateMock.mockRejectedValue(new Error("Boom"));

    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(
          ToastProvider,
          null,
          createElement(SaveAsTemplateButton, { versionId: "version-1" })
        )
      );
    });

    const openButton = renderer!.root.findAllByType("button")[0];

    await act(async () => {
      openButton.props.onClick();
    });

    const nameInput = renderer!.root.findByProps({ id: "template-name" });

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Template test" } });
    });

    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: () => undefined });
    });

    const errorToast = renderer!.root.findAll(
      (node) => node.type === "p" && node.children.join("") === "Enregistrement impossible"
    );
    expect(errorToast).toHaveLength(1);
  });
});
