import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import type { EstimateSendGatingFlag } from "@/lib/estimates/client";

afterEach(() => cleanup());

function flag(key: string, label: string): EstimateSendGatingFlag {
  return { key, severity: "blocking", count: 1, itemIds: ["line-1"], label, description: label };
}

function renderDialog(blockingFlags: EstimateSendGatingFlag[]) {
  render(
    <EstimateSendGatingDialog
      isOpen
      isSubmitting={false}
      phaseLabel={null}
      blockingFlags={blockingFlags}
      warningFlags={[]}
      canForce
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onForceConfirm={vi.fn()}
    />
  );
}

describe("EstimateSendGatingDialog", () => {
  it("offers an administrator the override for ordinary blockers", () => {
    renderDialog([flag("missing_price", "Prix manquant")]);
    expect(screen.getByRole("button", { name: "Forcer l'envoi" })).toBeInTheDocument();
  });

  // TI-682 (D25): a « Non chiffrée » line is classified before sending; no override is offered while one remains.
  it("withholds the override while a « Non chiffrée » line is still to classify", () => {
    renderDialog([flag("missing_price", "Prix manquant"), flag("not_priced_unclassified", "Lignes non chiffrées à classer")]);
    expect(screen.queryByRole("button", { name: "Forcer l'envoi" })).not.toBeInTheDocument();
    expect(screen.getByText(/Les lignes non chiffrées se classent avant l'envoi/)).toBeInTheDocument();
  });
});
